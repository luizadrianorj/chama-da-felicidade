# Chama da Felicidade — primeira rodada de melhorias

Esta versão preserva o diário existente, o Firebase e o estilo editorial. É uma versão de revisão: o GitHub Pages original continua publicando a branch `main` do repositório `luizadrianorj/chama-da-felicidade`. Não há migração de dados nem implantação automática de regras Firebase.

## Prévia e validação local

Os arquivos públicos estão na raiz para preservar a publicação atual do GitHub Pages. Rode `npm run dev` e abra a porta 3000. O botão **Explorar demonstração** carrega dados fictícios em memória, permite exercitar as telas e não grava no Firestore. Alterações de demonstração desaparecem ao sair ou recarregar.

`npm test` executa testes Node com funções puras e mocks DOM/Firebase/service worker, sem acessar dados reais. `npm run check` verifica a sintaxe JavaScript. Não existem dependências npm para instalar nesta rodada.

## Organização

`index.html` contém as telas; `styles.css`, o visual e a acessibilidade; `js/app.js`, sessão, interface e integração Firebase; `js/core.js`, validação, busca e cálculos testáveis; `js/catalog.js`, textos e categorias preservados; `sw.js`, o shell e atualização da PWA. Os testes estão em `tests/`; a auditoria e propostas Firebase ficam em `docs/`.

## Melhorias desta rodada

Os dados exibidos são escapados; os IDs de ações não são interpolados em handlers JavaScript. A troca de sessão limpa o contexto privado e descarta respostas antigas. O histórico tem paginação de 100 documentos por vez, estados de erro e nova tentativa, sem apagar registros já carregados. Busca combina texto normalizado, área e período inclusivo. Criar e editar usam a mesma validação; a edição inclui palavra e áreas. Os modais têm foco gerenciado, Escape e fundo inerte.

O rascunho fica em `sessionStorage`, separado por usuário e caminho. Resiste ao recarregamento na mesma aba e é removido ao sair. Não é criptografado, não sobrevive garantidamente ao fechamento da aba e não é um backup. O backup JSON é exportado explicitamente pelo usuário, informa se o histórico está parcial e contém conteúdo pessoal.

Os relatórios diferenciam registros, dias, gratidões e áreas. A frequência de áreas não é nota de satisfação. As datas usam o calendário local do dispositivo e as sequências deixam de comparar diferenças fixas de 24 horas. O app mantém domingo como início de semana, agora explicitamente rotulado.

A PWA armazena apenas o shell próprio, com caminhos relativos ao escopo e cache isolado; a atualização é oferecida ao usuário, sem recarga automática durante digitação. Não há cache persistente de diários nem sincronização offline de escritas nesta rodada. Sem rede, o shell/demonstração podem funcionar após instalação; login e acesso real ao Firestore continuam dependentes de conexão. Não são solicitadas permissões de notificação.

## Antes da publicação

Ler `docs/analise-completa.md` e `docs/firebase-revisao.md`. Confirmar regras, índices, domínio autorizado e login real no Firebase/Safari antes de mesclar a versão. `firestore.rules.proposed` e `firestore.indexes.proposed.json` são propostas não implantadas; não executar deploy sem revisar os documentos legados e testar no emulador.

Ainda estão no roadmap: garantia transacional de uma chama por usuário/dia, resolução de edições concorrentes, fuso fixo de negócio, avaliações reais da Roda da Vida ao longo do tempo, importação/restauração do backup, cache persistente privado opt-in, upgrade e empacotamento das dependências Firebase e publicação Pages via Actions. Lembretes, tarefas recorrentes e IA não foram selecionados.
