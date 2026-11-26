# CRM Apito

CRM para empresas, contatos e negócios, com acesso autenticado e integrações Kommo e MeEventos.

## Banco de dados

O **Brain Apito** é a base central de dados, independente da interface do CRM. A reorganização usa o banco PostgreSQL `brain_apito` na VPS, com cadastros compartilhados em `brain`, dados operacionais do CRM em `crm` e informações das fontes nos schemas `address_book`, `kommo_import` e `crm_enrichment`. O CRM é um consumidor dessa base; outros sistemas devem usar identidades e permissões próprias.

**Estado da reorganização: pendente de corte e validação de produção.** O corte bloqueia conexões à origem `anselmo`, encerra as sessões existentes e cria uma cópia preservada para gerar o candidato final. As bases anteriores são mantidas, sem `DROP DATABASE`. O estado e as evidências de implantação ficam no [registro de migração do Brain Apito](docs/brain-apito.md). Não considere esta mudança online apenas pela publicação do código.

As mídias ficam separadas do PostgreSQL, em `/srv/crm-apito-media`, e compõem o acervo do Brain. A reorganização não move essa pasta nem altera os IDs dos arquivos. O backup completo deve incluir banco e mídias. O tamanho do banco sozinho não representa o espaço de todos os dados.

O esquema para instalações novas está em [`schema.sql`](schema.sql). A reorganização de uma base existente exige a migração revisada e as verificações descritas na documentação; não inicialize uma base vazia como substituição dos dados existentes. Não publique bancos, arquivos comerciais, strings de conexão, senhas ou chaves no GitHub.

## Configurar e executar

Requer Node.js 24. Instale as dependências com `npm install`, crie um `.env` privado com base em `.env.example` e defina:

- `CRM_VPS_CONNECTION`: configuração protegida de conexão por SSH com a VPS; prevalece sobre `DATABASE_URL`. Depois do corte validado, `database` aponta para `brain_apito`, `user` usa a identidade `brain_crm` e `searchPath` contém exatamente `crm,brain,public`. Use a conta SSH dedicada ao túnel restrito para o PostgreSQL e mantenha a verificação do fingerprint do servidor.
- `DATABASE_URL`: alternativa de conexão PostgreSQL para o usuário de aplicação, quando `CRM_VPS_CONNECTION` não estiver definida. Conexões diretas remotas devem usar TLS com certificado validado.
- `BRAIN_APITO_SEARCH_PATH`: alternativa ao campo `searchPath`, com o valor exato `crm,brain,public`. Se ambos estiverem ausentes ou vazios, o código preserva a configuração de schemas do servidor.
- `CRM_ADMIN_USER` e `CRM_ADMIN_PASSWORD`: credenciais de acesso ao CRM; a senha deve ter ao menos 16 caracteres.
- `CRM_SESSION_SECRET`: segredo aleatório com ao menos 32 caracteres para assinar o cookie de sessão.
- `CRM_ENCRYPTION_KEY`: chave aleatória de 32 bytes em hexadecimal (64 caracteres) para criptografar tokens das integrações.

Carregue as variáveis do `.env` no ambiente do processo e execute `npm start`. Acesse `http://127.0.0.1:4317`. Para Docker, `docker compose up --build` lê o `.env` e mantém a porta vinculada apenas à máquina local. Na Vercel, configure as credenciais e a conexão em **Environment Variables**, sem prefixo `NEXT_PUBLIC_`. O pool identifica suas conexões como `crm-apito` em `application_name`.

Esta versão da aplicação exige os schemas `brain` e `crm` já migrados. A preservação do comportamento legado no conector não torna o código novo compatível com as tabelas antigas em `public`. Um retorno ao banco `anselmo` exige também a versão anterior do CRM.

Para gerar os dois segredos independentemente: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

## Segurança e operação

O login usa cookie de sessão assinado, `HttpOnly` e `SameSite=Strict`, com validade de um dia. As rotas de dados e integrações exigem sessão válida. Os tokens Kommo/MeEventos ficam criptografados no PostgreSQL; mantenha `CRM_ENCRYPTION_KEY` estável para poder lê-los após novas implantações. Altere a senha e o segredo de sessão para invalidar acessos anteriores.

O papel `brain_crm` é a identidade própria do CRM no destino. Os grupos sem login `brain_readonly` e `brain_editor` permitem conceder acesso ao cadastro central e às fontes autorizadas a outros consumidores, sem expor as tabelas operacionais ou as configurações privadas do CRM. Não compartilhe a credencial do CRM com esses sistemas. A origem `anselmo`, o papel legado `crm_web_vps` e sua configuração ficam preservados para um retorno controlado, sem manter duas fontes graváveis em paralelo.

Os arquivos estáticos em `public/` não contêm dados do CRM nem segredos. O acesso aos dados é negado quando a configuração de autenticação ou do banco está ausente. A publicação no GitHub, por si só, não significa que o CRM está online; confirme o status de implantação e teste o login e a leitura do banco após cada deploy.
