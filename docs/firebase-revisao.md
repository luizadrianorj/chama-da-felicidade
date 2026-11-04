# Firebase — revisão pendente de produção

A configuração cliente do app aponta para `chama-da-felicidade-f0a97`; o README original citava outro projeto. Os identificadores públicos da configuração Firebase foram preservados. A autorização dos dados depende das regras implantadas, e não de esconder a configuração cliente.

O arquivo `firestore.rules.proposed` é uma proposta não implantada. Ele separa leitura, criação, atualização e exclusão; preserva proprietário e data de criação; limita campos editáveis; verifica tipos, tamanhos, gratidões e áreas conhecidas. Foi elaborado a partir da documentação oficial [1] [2]. Não foi compilado no emulador nesta rodada. Pode bloquear edição de registros legados com campos extras ou dados fora dos limites: revisar essa compatibilidade antes de adotar.

O arquivo `firestore.indexes.proposed.json` descreve o índice composto da consulta `uid == usuário`, ordenada por `createdAt desc`. Um limite por página não remove a exigência de índice. Nenhum índice foi criado nem nenhuma regra foi substituída.

Antes da publicação, confirmar projeto, regras atuais, índice, provedor Google e domínios autorizados no Console. A prévia Manus não está automaticamente autorizada no Firebase e oferece demonstração com dados fictícios. Também falta testar login Google no Safari/iPhone real e o comportamento de redirecionamento com as políticas de armazenamento do navegador.

A unicidade de uma chama por usuário/dia e a detecção de edições concorrentes continuam no próximo ciclo. O cliente impede repetição imediata e usa o registro correto, mas duas sessões ainda exigem garantia transacional no banco. Também falta escolher um fuso de negócio fixo: esta rodada preserva a data civil do dispositivo, corrigindo o cálculo de sequências sem supor dias de exatamente 24 horas.

## References

[1]: https://firebase.google.com/docs/firestore/security/insecure-rules "Firebase — correção de regras inseguras"
[2]: https://firebase.google.com/docs/firestore/security/rules-fields "Firebase — validação e controle de campos"
