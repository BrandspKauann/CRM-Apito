# CRM Apito

CRM para empresas, contatos e neg�cios, com telas para configurar as integra��es Kommo e MeEventos.

## Executar

Requer Node.js 24 ou Docker. Execute `node server.mjs` e acesse `http://127.0.0.1:4317`. Para Docker, execute `docker compose up --build`; a porta permanece vinculada � m�quina local.

O banco SQLite e a chave de criptografia das integra��es s�o gerados em `data/`, que n�o � versionado. Preserve esse diret�rio em backups privados. Para trocar o caminho do banco, configure `CRM_DB`; para trocar a porta, configure `PORT`.

## Aten��o antes de publicar na internet

Esta vers�o n�o possui autentica��o nas rotas do CRM e de integra��es. A configura��o atual limita a porta Docker a `127.0.0.1`. Adicione autentica��o e controle de acesso antes de expor a aplica��o publicamente.
