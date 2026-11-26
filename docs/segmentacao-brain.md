# Segmentação do Brain Apito

> Em 26/11/2026, restaurei a interface anterior de segmentação por solicitação
> de Kauann. Os detalhes abaixo documentam a implementação adicional, que deixou
> de ser a tela padrão. Preservei os dados, listas e histórico no Brain; não
> removi tabelas nem alterei a conexão do CRM.

A área **Segmentação de contatos** do CRM usa a base `brain_apito`, com contatos,
empresas e oportunidades separados. Há 14 dimensões, 16 listas compartilhadas,
editor de condições E/OU/NÃO, prévia paginada, justificativas por integrante,
cobertura por campo e fila de revisão. As listas anteriores continuam acessíveis
na aba **Listas anteriores**; nenhuma foi apagada ou convertida automaticamente.

## Dados e significado

A leitura inicial de 26/11/2026 confirmou 22.211 contatos, 3.221 empresas, 8.471
oportunidades do Kommo, 7.968 contatos da agenda, 456.451 registros de origem e
544.338 relações. Esses totais não representam pessoas únicas; a agenda não é
somada aos contatos centrais. A unidade da lista é o ID da entidade, uma vez por
resultado, mesmo quando há várias oportunidades relacionadas.

O inventário completo, o dicionário de campos e as 16 regras versionadas estão
na própria interface. `segment-rules.mjs` define os campos, tipos, sugestões de
vocabulário e a versão `brain-segments/2`. O endpoint autenticado
`GET /api/brain-segments` apresenta contagens atuais, preenchimento, IDs/tipos e
opções originais dos campos Kommo, cobertura das classificações, metadados da
sincronização e quantidade por lista. Não inclui chaves ou configurações de
integração. Há vocabulários sugeridos para vínculos, setores, natureza, área,
papel, especialidade, interesse, canal, situação do evento e revisão de identidade.

O índice de consulta é montado em memória a partir de uma transação de leitura
REPEATABLE READ, com cache de até 30 segundos por processo. Uma nova consulta
após esse prazo lê as importações novamente. **Atualizar fontes** força a leitura
da base já importada; não chama APIs externas ou inicia uma importação Kommo.
A hora da leitura e as datas/estados das importações são exibidas separadamente.
Cada consulta SQL tem timeout de 15 segundos. Limite: 100 resultados por página
na API (25 na tela), 80 nós e seis níveis de regras, 32 KB por requisição.

## Evidências e identidades

Cada fato guarda valor, valor original, fonte, identificador de origem, data
quando disponível, método, estado e versão. Texto no nome pode sugerir setor ou
especialidade; não confirma esse atributo. Valores ausentes, rejeitados ou apenas
sugeridos não satisfazem comparações como se fossem confirmados. Conflitos têm
estado próprio, inclusive quando não há um valor selecionado.

O identificador Kommo é sempre composto por conta + ID. O vínculo existente
`crm_contact_sources` é usado quando há exatamente um contato central e uma
conta inequívoca para a identidade de origem. Vínculos duplicados são deduplicados.
Candidatos ambíguos do Kommo, correspondências MeEventos a revisar e possíveis
duplicidades da agenda alimentam a fila de revisão. Não são realizadas fusões
por nome, telefone, empresa ou qualquer outro atributo. Um emprego compartilhado
não identifica um comprador: oportunidades não são atribuídas à empresa atual
do contato sem uma correspondência própria. Essa correspondência empresarial
entre sistemas ainda depende de validação; permanece desconhecida.

As etapas são resolvidas por **account_id + pipeline_id + status_id**. O estado
técnico de fechamento é separado do resultado comercial. Por exemplo, 142 em
PROSPECT/“VIROU LEAD” não confirma venda; 143 em OPERACIONAL/“CLIENTES” não é
classificado como perda comercial. “ATENDIMENTO FINALIZADO” significa atendimento
encerrado, não venda perdida. A lista de recuperação combina encerramento
comercial documentado com motivo registrado. A classificação automática de
cliente exige “Venda ganha” no FUNIL COMERCIAL; demais contextos exigem revisão.

Datas, serviço, etapa e participantes dentro de um grupo com escopo
**Mesma oportunidade** são avaliados no mesmo negócio. Um grupo pode exigir
uma empresa ou contato relacionado; grupos externos combinam os escopos.
Um NÃO sobre dado desconhecido continua indeterminado. O operador
**Desconhecido ou não confirmado** deve ser escolhido explicitamente para incluí-lo.
**Informado e confirmado** exclui ausentes por definição: sua contagem de
“indeterminados” pode ser zero mesmo quando não há ninguém classificado.
O relatório de cobertura mostra a ausência de dados independentemente da lista.

## Revisão humana e persistência

A migração aditiva `006_brain_segments.sql` cria duas tabelas no Brain:

- `brain.segment_saved_lists`: regras compartilhadas e versionadas.
- `brain.segment_annotations`: revisões imutáveis, autor autenticado, fonte,
  evidência obrigatória, data e referência à decisão anterior.

As anotações humanas são aplicadas depois das extrações. Uma importação não as
substitui. Novas revisões acrescentam linhas; não alteram ou apagam o histórico.
Há trava por entidade/campo e checagem da revisão anterior: uma edição concorrente
retorna 409 e exige atualização. Vários valores são permitidos, por exemplo
cliente e parceiro. Desconhecido, rejeitado e conflito são decisões explícitas.
A fila permite filtrar sugestões, conflitos e identidades. A decisão de identidade
apenas documenta a revisão; não funde ou exclui registros.

O login da aplicação pode ler/inserir nas novas tabelas e usar as sequências;
não recebe UPDATE/DELETE para reescrever o histórico. Fontes originais e cadastros
permanecem preservados. Não há disparo de campanhas nesta funcionalidade.

Implantação: aplicar a migração com administrador autorizado na base correta;
executar `node scripts/seed-brain-segments.mjs` com o ambiente protegido do CRM.
A carga das 16 listas é idempotente e preserva nomes/regras existentes. Não há
credenciais nos arquivos versionados. A integração MCP não é pré-requisito para
usar esta tela, que consulta o banco pelo túnel privado já configurado.

## Limitações explícitas da base

Mensagens e `address_book.enrichment_facts` estão vazias no inventário inicial.
Não há recência de respostas inferida de `talks` ou `synced_at`. Preferência de
canal, WhatsApp ativo e entrega de email não são inferidos de um número/endereço.
A normalização telefônica indica formato internacional explícito na origem,
que continua não verificado; formatos/países não resolvidos não contam como
normalizados. Cidade do contato vem apenas do endereço da agenda, com conflitos
preservados; cidade da empresa e local do evento têm campos distintos.

Preço não representa recebimento. Não são somados valores de oportunidades nem
calculadas contratações distintas a partir de cópias em funis diferentes.
Recorrência em 12/24 meses, valor recebido e última contratação exigem fonte
comprovada/revisão registrada antes de ativar os respectivos filtros. As 14
dimensões são utilizáveis, mas listas sem evidência confirmada permanecem vazias.
As classificações manuais não constituem validação automática de contratos.

## Verificação e critérios de aceite

1. Inventário real e separado por entidade: conferido na VPS e pela API.
2. 14 dimensões com tipos e vocabulário: disponíveis na interface e metadados.
3. 16 listas iniciais: criadas e contagens conferidas por prévia individual.
4. E/OU/NÃO e desconhecidos: testes de lógica de três estados.
5. Correlação na mesma oportunidade: teste com dois negócios de condições distintas.
6. Conta/funil/etapa: dicionários compostos e inspeção dos metadados reais.
7. Valores originais e IDs de campos: preservados nas evidências e no inventário.
8. Prévia antes de salvar: fluxo da tela; alteração de regra invalida a prévia.
9. Justificativa por integrante: fonte, valor, regra e referência mostrados.
10. Classificações múltiplas: gravação transacional validada com rollback.
11. Histórico e concorrência: revisão anterior e rejeição de edição obsoleta testadas.
12. Correções preservadas: tabela separada e aplicação após extração, sem sobrescrita.
13. Atualização: releitura por prazo ou botão, datas e fontes visíveis.
14. Contagens sem multiplicação de integrantes: IDs únicos e paginação verificados.
15. Cobertura e fila de revisão: confirmados/sugeridos/conflitos/desconhecidos.
16. Autenticação, origem e validação: API sem login e origem externa bloqueadas.
17. Interface responsiva e listas antigas: prévia inspecionada no navegador,
    sem rolagem horizontal da página em tamanho de celular; acesso legado preservado.

Foram executados os 24 testes anteriores e sete testes novos de regras,
verificações de sintaxe, API autenticada com dados reais, as 16 listas e
paginação, além da gravação de revisões/lista numa transação revertida. Nenhuma
classificação de teste permaneceu na base. A verificação de produção, commit e
implantação deve constar na tarefa de suporte vinculada à entrega; publicação
no GitHub sozinha não comprova que a versão está online.
