# CRM Apito

CRM para empresas, contatos e negócios, com acesso autenticado e integrações Kommo e MeEventos.

## Banco de dados

Os dados ficam no PostgreSQL/Neon, fora da aplicação. O projeto Neon `anselmo-data`, banco `anselmo`, contém as tabelas `companies`, `contacts`, `deals` e `integration_configs`; o esquema reproduzível está em [`schema.sql`](schema.sql). A aplicação recebe a string de conexão por `DATABASE_URL` e não cria nem mantém um banco local.

Os dados que existiam no SQLite original foram conferidos no Neon: um negócio foi preservado com o mesmo ID e conteúdo. Não publique arquivos de banco, strings de conexão, senhas ou chaves no GitHub.

## Configurar e executar

Requer Node.js 24. Instale as dependências com `npm install`, crie um `.env` privado com base em `.env.example` e defina:

- `DATABASE_URL`: conexão **pooled** do Neon para o usuário de aplicação.
- `CRM_ADMIN_USER` e `CRM_ADMIN_PASSWORD`: credenciais de acesso ao CRM; a senha deve ter ao menos 16 caracteres.
- `CRM_SESSION_SECRET`: segredo aleatório com ao menos 32 caracteres para assinar o cookie de sessão.
- `CRM_ENCRYPTION_KEY`: chave aleatória de 32 bytes em hexadecimal (64 caracteres) para criptografar tokens das integrações.

Carregue as variáveis do `.env` no ambiente do processo e execute `npm start`. Acesse `http://127.0.0.1:4317`. Para Docker, `docker compose up --build` lê o `.env` e mantém a porta vinculada apenas à máquina local. Na Vercel, configure as quatro credenciais e a conexão em **Environment Variables**, sem prefixo `NEXT_PUBLIC_`.

Para gerar os dois segredos independentemente: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

## Segurança e operação

O login usa cookie de sessão assinado, `HttpOnly` e `SameSite=Strict`, com validade de um dia. As rotas de dados e integrações exigem sessão válida. Os tokens Kommo/MeEventos ficam criptografados no PostgreSQL; mantenha `CRM_ENCRYPTION_KEY` estável para poder lê-los após novas implantações. Altere a senha e o segredo de sessão para invalidar acessos anteriores.

Os arquivos estáticos em `public/` não contêm dados do CRM nem segredos. O acesso aos dados é negado quando a configuração de autenticação ou do banco está ausente. A publicação no GitHub, por si só, não significa que o CRM está online; confirme o status de implantação e teste o login e a leitura do banco após cada deploy.
