# CRM Apito: conclusão de alterações

Ao concluir uma alteração neste CRM:

1. Verifique a mudança com testes ou inspeções proporcionais ao que foi alterado. Registre o que foi e o que não foi verificado.
2. Publique o código em `BrandspKauann/CRM-Apito` e confirme o commit na branch apropriada. Não inclua bancos de dados, chaves, tokens, senhas ou outros segredos no repositório.
3. Documente a mudança concluída em primeira pessoa, como Kauann, pela API da **conta de Kauann** no Central Suporte do Apito, no projeto **CRM Apito** (projeto 4 em `https://suporte-apito-lglw.vercel.app`). Confirme a identidade da conta com `GET /api/v2/user` antes de escrever. Inclua data, resumo, commit, verificações e limitações. Use o token da conta correta somente como credencial da API e nunca o grave no código ou na documentação.
4. Envie um email para `contato@apitodemestre.com.br` a partir da conta Hostinger `kauann@bazhi.com.br`, resumindo a alteração, o commit, o registro no Central Suporte e o estado da implantação.
5. Confirme o resultado das três ações externas antes de declarar a alteração concluída. Se uma falhar, informe o passo pendente com precisão e retome a partir dele, sem duplicar registros ou emails.

Uma publicação de código não implica implantação. Consulte o projeto da Vercel e só descreva a versão como online após confirmar uma implantação funcional. Mudanças ainda não concluídas devem aparecer como pendentes na documentação e no email.
