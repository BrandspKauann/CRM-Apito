# Brain Apito — base central independente

## Estado da entrega

**Migração concluída e CRM validado em produção em 25/11/2026 (America/Sao_Paulo).**

| Verificação | Resultado e evidência |
|---|---|
| Base central | Banco físico `brain_apito`; 22.211 contatos e 3.221 empresas em `brain`, operações da aplicação em `crm` |
| Fontes preservadas | 456.451 registros Kommo, 544.338 relações, 7.968 contatos de agenda, 51.328 campos da agenda e 23.266 vínculos com fontes |
| Backup atual | Dump restaurado e conferido; cópia final consistente da origem e novo dump do Brain organizado, além dos papéis protegidos |
| Mídias | 2.383 arquivos; 7.728.582.335 bytes; SHA256 de cada arquivo comparado com o backup tar; caminhos e referências preservados |
| Integridade | Conteúdo das 21 tabelas comparado por hashes por schema/tabela, incluindo os dois `contacts`; constraints, sequências/`is_called` e dois LOs conferidos |
| Dados auxiliares do CRM | 1.143 marcas, uma lista salva e 23.773 eventos de histórico lidos pelo conector real |
| Separação de acesso | Papel `brain_crm`, túnel SSH próprio sem shell, grupos `brain_readonly` e `brain_editor`; escrita do leitor, leitura de `crm.integration_configs` e leitura direta de LO privado foram recusadas |
| Corte consistente | Origem congelada com `ALLOW_CONNECTIONS false`, sessões encerradas e cópia final via `TEMPLATE`; nenhuma base foi excluída |
| Produção | Login, contatos, empresas, listas, integrações e `/api/data-source` HTTP 200; edição de contato mantendo os mesmos valores confirmada no endereço público |
| IDs de contatos | SHA256 da lista de IDs idêntico antes/depois: `f074b2a77500f957d864e7bd3cfcbe246113b48ccdc2bf37cd3d809bf1c268f1` |
| Testes | 24 testes Node e verificação sintática; integração com PostgreSQL real e migração SQL idempotente em transação desfeita |
| Implantação de corte | Aplicação `7030aba`, deployment `dpl_VsNyrQrevVLc9c1LCRUZjkxgw9yx`, promovido e conferido em https://crm-apito.vercel.app/ |
| Registro no suporte | Brain: https://suporte-apito-lglw.vercel.app/tasks/16; conector CRM: https://suporte-apito-lglw.vercel.app/tasks/17 |

O catálogo sem credenciais está na VPS em `/etc/brain-apito/catalog.json` e em
`/srv/vps-mcp/workspaces/brain-apito/catalog.json`, para consulta autenticada pelo MCP.
Backups e manifestos completos permanecem protegidos em `/var/lib/brain-apito/backups`.
O relatório abaixo contém somente contagens e evidências operacionais, sem cadastros
ou segredos: [evidências da migração](brain-apito-evidencias-2026-11-25.json).

## O que é o Brain Apito

O Brain Apito é o acervo central da empresa: cadastros de pessoas e empresas, informações das fontes, relações e arquivos vinculados. A aplicação CRM usa esse acervo e mantém seus próprios processos em uma área separada. Outros sistemas podem se conectar à mesma base sem receber a credencial ou o acesso operacional do CRM.

O banco físico de destino se chama `brain_apito` e usa o PostgreSQL já existente na VPS. Não é um banco embutido no CRM nem um novo PostgreSQL vazio criado pela aplicação. O contêiner `apito-crm-postgres` e seu volume podem conservar os nomes operacionais atuais; o nome do contêiner não determina quem é dono dos dados.

Um cadastro textual pode ocupar pouco espaço mesmo contendo milhares de contatos. O PostgreSQL também usa índices e armazenamento eficiente para dados estruturados. Espaço em disco não substitui a contagem de registros, a conferência dos campos ou a validação dos vínculos. As mídias ocupam espaço separado e continuam fazendo parte do acervo.

## Organização dos dados

| Schema | Responsabilidade |
|---|---|
| `brain` | Cadastro compartilhado de empresas e contatos, em `companies` e `contacts`, com os IDs existentes preservados. |
| `crm` | Negócios, histórico e segmentação usados pelo CRM, escalas de eventos, automações e configurações da aplicação. |
| `address_book` | Registros e campos da agenda de contatos de origem. |
| `kommo_import` | Registros importados, relações entre entidades, estado de sincronização e referências aos arquivos. |
| `crm_enrichment` | Informações complementares, correspondências e procedência dos dados. |

Os schemas das fontes são preservados, com suas informações e identificadores. A mudança de organização não deve descartar campos extras, substituir IDs, fundir cadastros por semelhança de nome ou reconstruir a base somente com os campos visíveis na tela do CRM.

Mover uma tabela entre schemas deve preservar seus dados, índices, constraints e referências. Relações entre contatos, empresas, negócios, escalas e fontes precisam continuar válidas depois da reorganização. A migração deve seguir o inventário real da origem, inclusive objetos que não constam de uma instalação nova em `schema.sql`.

## Conexões e permissões

O CRM usa a nova identidade PostgreSQL `brain_crm` no destino. Depois do corte validado, o campo `database` da configuração protegida `CRM_VPS_CONNECTION` aponta para `brain_apito`, `user` contém `brain_crm` e `searchPath` contém a string exata `crm,brain,public`.

Os dois objetos grandes PostgreSQL (LOs) usados pela aplicação passam de `crm_web_vps` para `brain_crm`, mantendo compatibilidade com os carregadores que verificam sua propriedade por `current_user`. As tabelas movidas para `brain` e `crm` ficam sob administração de `brain_owner`, e a aplicação recebe concessões específicas. Os IDs e conteúdos devem permanecer iguais; a origem e o papel legado continuam preservados para recuperação.

`CRM_VPS_CONNECTION` prevalece sobre `DATABASE_URL`. Quando o campo `searchPath` estiver vazio ou ausente, a variável `BRAIN_APITO_SEARCH_PATH` pode fornecer o mesmo valor. O código aceita apenas a composição prevista; não use esse campo para inserir comandos ou outros schemas. Sem nenhum dos dois valores, permanece o comportamento legado de schemas configurado no servidor.

Essa compatibilidade do conector não é compatibilidade da aplicação inteira com a estrutura antiga. O código desta versão usa referências explícitas a `brain` e `crm`; a migração deve estar aplicada antes da publicação. Uma reversão à estrutura antiga também precisa retornar à versão anterior do CRM.

O pool usa `application_name=crm-apito`, permitindo identificar as conexões da aplicação. O destino usa uma conta SSH dedicada com túnel restrito ao PostgreSQL e sua própria chave autorizada, mantendo a verificação do fingerprint SHA256 do servidor. A configuração legada não é reutilizada como credencial dos novos consumidores. A conexão não exige publicar a porta 5432 na internet. Na alternativa de conexão direta remota, use TLS e valide o certificado do servidor.

Novos consumidores devem ter identidades PostgreSQL próprias, com as permissões necessárias ao seu trabalho. Os grupos `brain_readonly` e `brain_editor` são papéis **sem login**:

- `brain_readonly` permite conceder leitura do cadastro central e das fontes autorizadas.
- `brain_editor` permite conceder edição do cadastro compartilhado e leitura das fontes autorizadas.
- Esses grupos não dão acesso às configurações privadas nem aos dados operacionais do schema `crm`.

O administrador deve criar cada identidade com um segredo próprio e atribuir o grupo adequado. Não copie a senha, a chave do túnel ou o JSON completo do CRM para outro sistema. Papéis de leitura não devem ganhar escrita por associação indireta, e nenhum desses consumidores deve receber `SUPERUSER`, propriedade do banco ou permissão para criar objetos nos schemas de aplicação.

Preserve `CRM_ENCRYPTION_KEY`: ela protege os tokens das integrações já gravados. A reorganização do banco não é uma rotação desses segredos. Senhas, chaves e strings completas de conexão ficam somente em arquivos privados protegidos ou nos segredos do ambiente de execução.

## Mídias e referências

As mídias permanecem em `/srv/crm-apito-media`. A conferência anterior encontrou 2.383 arquivos, totalizando 7.728.582.335 bytes — aproximadamente 7,73 GB decimais. Esses números são uma observação anterior, não um substituto para o manifesto atualizado da migração.

Essa pasta é um componente do Brain Apito. A reorganização do banco **não transfere a pasta**, não altera os nomes dos arquivos e não converte os anexos em colunas binárias apenas para aumentar o tamanho do PostgreSQL. As referências de `kommo_import.local_files` e os acessos do CRM às mídias precisam ser preservados e conferidos.

## Backup e verificação

Antes do corte, preserve um backup atual do banco e uma exportação protegida dos papéis/permissões necessários. Os dumps da migração anterior, de 23/11/2026, não comprovam que edições posteriores estejam protegidas.

O conjunto de recuperação inclui:

1. Backup PostgreSQL consistente, com todas as tabelas, sequências, índices, funções, constraints e os objetos grandes (LOs) existentes.
2. Manifesto atualizado das mídias, com nomes, tamanhos e checksums, e proteção da pasta ou cópia recuperável dos arquivos.
3. Registro dos papéis e concessões, sem expor os segredos nos relatórios ou no GitHub.
4. Referência da configuração da aplicação e preservação das chaves de criptografia e do acesso de rede.

A comparação entre origem e destino deve conferir contagens por tabela, IDs, conteúdo e campos extras, relacionamentos e registros órfãos, além dos valores das sequências e dos IDs e conteúdos dos dois LOs. Confirme também que as referências aos arquivos resolvem para as mesmas mídias. Não use somente `n_live_tup`, que é uma estimativa, como prova de igualdade dos registros.

Restaure o backup em um ambiente controlado e valide a leitura antes de trocar a conexão de produção. Para evitar alterações perdidas, o inventário e a cópia devem ter um corte consistente das escritas ou um mecanismo explícito de sincronização final. Não mantenha duas cópias graváveis do cadastro como fontes independentes.

## Corte, validação e retorno

O corte só deve ocorrer depois de testar a nova aplicação contra a base de validação. O procedimento preserva a origem e os candidatos anteriores, sem excluir bases:

1. Prepare e teste a aplicação nova na base `brain_apito` de validação, ainda sem promover o domínio de produção. A conexão nova usa credenciais próprias; não é necessário extrair os demais segredos sensíveis já configurados na Vercel.
2. Bloqueie novas conexões à origem com `ALTER DATABASE anselmo ALLOW_CONNECTIONS false` e encerre **todas** as sessões conectadas a ela. Mantenha a sessão de administração em outro banco. Isso impede que pools existentes, importadores ou usuários continuem gravando durante a cópia.
3. Crie `anselmo_cutover_<data>` com `TEMPLATE anselmo`, sob administração de `brain_owner`. Preserve essa cópia sem escritas. Restrinja seu acesso aos administradores necessários para gerar o manifesto e um novo `pg_dump`; não conceda acesso às aplicações.
4. Crie um candidato final a partir dessa cópia congelada. Organize os schemas, LOs, proprietários e privilégios no candidato e compare seus dados com o arquivo de corte. Normalize somente os nomes de schemas que mudaram na comparação; não omita tabelas de mesmo nome em schemas diferentes.
5. Bloqueie conexões e encerre as sessões da base de validação usada no primeiro passo. Preserve-a com um nome de validação datado. Renomeie o candidato final validado para `brain_apito`.
6. Promova a implantação previamente preparada, com o JSON de conexão novo apontando para `brain_apito`, e confira o domínio de produção e os fluxos de dados.

O bloqueio e o encerramento das sessões provocam uma janela de manutenção para os consumidores da origem. Registre o início e o fim reais, sem prometer disponibilidade contínua nesse intervalo. Não troque o domínio ou reabra escritas antes de validar o candidato final.

A origem `anselmo`, o papel `crm_web_vps`, a configuração legada e a cópia de corte permanecem preservados para recuperação. A origem não volta a aceitar conexões de aplicação automaticamente. Não exclua esses recursos para concluir a reorganização.

Depois de atualizar a conexão e publicar o CRM, valide em `https://crm-apito.vercel.app/`: autenticação, leitura de contatos e empresas, informações complementares, edição com persistência, relações com negócios/escalas e acesso às mídias. Registre os testes efetivamente executados, o commit e a implantação funcional.

Teste os limites dos novos papéis: leitura autorizada deve funcionar, escrita com papel de leitura deve falhar e acesso às tabelas privadas de `crm` por consumidores do Brain deve ser negado. A configuração da conexão, sozinha, não comprova essas permissões.

Se for necessário retornar à origem, bloqueie as escritas no destino e confira o que mudou desde o corte. Se já houve edições no Brain, reconcilie-as antes de retornar; apontar para uma cópia antiga diretamente perderia essas alterações. Depois dessa conferência, retorne **a configuração de conexão e a versão anterior da aplicação**, reative controladamente as conexões à origem e valide os fluxos no domínio de produção. Preserve todas as bases e registre o motivo e o resultado do retorno. O código novo não deve ser usado contra o schema antigo em `public`.

## Limites desta reorganização

Esta migração não implanta automaticamente o pacote experimental `Brain_Apito_v0.1.0`, de 18/11/2026. Aquele pacote propõe outro modelo, com identidades UUID e workspaces, e exige uma migração própria revisada. Não deve ser iniciado como substituição dos cadastros atuais.

Não há promessa de nova API web de negócio, novos conectores, serviço de sincronização ou ferramenta MCP semântica para o Brain nesta mudança. O MCP administrativo da VPS continua independente e conserva seu fluxo de autorização. O objetivo desta etapa é organizar a base existente e os acessos dos consumidores, preservando o acervo e o funcionamento do CRM.
