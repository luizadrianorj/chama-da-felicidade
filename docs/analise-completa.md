# Chama da Felicidade — análise completa e execução inicial

A análise do código encontrou problemas de segurança, histórico, sessão, acessibilidade e coerência dos relatórios. A execução já começou em uma versão de revisão, preservando o Firebase, a coleção `chamadas`, o estilo de jornal e o GitHub Pages original. A prioridade é tornar o diário confiável antes de acrescentar recursos maiores.

A referência da auditoria é o commit `0d7e6d97c3348938c83f7ad2f2688cf549d74eef`. As evidências abaixo citam essa versão original. Os testes desta rodada usam dados fictícios e mocks; nenhum registro pessoal foi criado, alterado ou excluído no Firebase durante o trabalho.

## O que já foi executado

A primeira rodada protege a exibição dos campos do diário, limpa o contexto privado ao sair e descarta respostas antigas quando a sessão muda. O histórico ganhou paginação, mensagens de falha e nova tentativa, sem apagar a lista já carregada. Busca combina texto sem diferença de acentos, área e período. Criação e edição usam a mesma validação, e a edição agora inclui palavra do dia e áreas.

O rascunho pode ser recuperado após recarregar a mesma aba, separado por usuário e caminho. Os relatórios distinguem registros, dias, gratidões e áreas. A frequência das áreas tem denominador e não é apresentada como satisfação. A palavra do dia aparece no mês, e a exportação inclui fallback e backup JSON com indicação de histórico parcial.

A interface preserva a identidade editorial, com zoom liberado, áreas seguras do iPhone, alvos de toque maiores, rótulos associados, foco visível e chips utilizáveis por teclado. Os diálogos têm foco gerenciado, Escape e fundo inerte. As cores de texto pequeno foram ajustadas dentro da paleta existente; as combinações revisadas tiveram contraste calculado acima de 4,5:1 em ambos os temas.

O código foi separado em HTML, CSS, catálogo de textos, integração e funções puras. O service worker usa caminhos relativos ao escopo, cache isolado e política de atualização, sem apagar caches de outros apps. Foi removido o pedido automático de notificação. A demonstração permite explorar telas com registros fictícios, mantidos só em memória.

Foram adicionados 39 testes automatizados, todos aprovados, cobrindo funções de calendário, validação, busca, proteção HTML, sessão, paginação, edição, exclusão e service worker. Também passaram verificações de sintaxe e consistência dos IDs e rótulos HTML. Uma revisão independente encontrou três ajustes menores de datas futuras e mensagens de login, corrigidos antes da entrega. Isso não equivale a testar login real, renderização no Safari ou regras implantadas.

## 1. Segurança dos registros — prioridade alta

### Conteúdo pessoal interpretado como HTML

Na versão original, `entryCardHTML` interpolava manchete, resumo, palavra e áreas diretamente em `innerHTML` (`index.html:688–704`). O mês e a semana repetiam esse padrão (`883–903` e `963–976`). Uma entrada com marcação maliciosa poderia ser interpretada como conteúdo ativo quando exibida.

**Executado:** os valores pessoais são escapados antes de entrar nas estruturas HTML. Ações dos cards usam identificadores em atributos de dados, não conteúdo do documento interpolado em código JavaScript. Os testes exercitam payloads de HTML em cards, mês e relatórios. Há sanitização de tipos e áreas conhecidas na leitura; o ID fornecido pelo Firestore não pode ser sobrescrito por um campo do documento.

**Depois:** remover também os handlers inline estáticos remanescentes, empacotar as dependências e estudar uma Content Security Policy adequada ao GitHub Pages. Escape no cliente não substitui regras de autorização no banco.

### Regras do Firestore documentadas

O README original permitia atualização verificando apenas o dono anterior (`README.md:35–43`). Não exigia que o novo `uid` continuasse igual. Também não limitava campos, tipos, tamanhos ou quantidade de gratidões. Essa é uma falha nas regras documentadas; não foi possível afirmar que sejam as regras efetivamente implantadas.

**Preparado, não implantado:** `docs/firestore.rules.proposed` separa leitura, criação, atualização e exclusão; preserva proprietário e data de criação; restringe campos editáveis; valida tipos, limites e áreas. A proposta segue a documentação oficial [1] [2]. Não foi compilada no emulador nesta rodada e pode exigir ajustes para documentos legados com campos adicionais.

Antes de adotá-la, exportar ou copiar as regras atuais, testar no Emulator/Rules Playground e confirmar compatibilidade com os registros existentes. Não publicar uma regra que bloqueie inadvertidamente a edição de dados antigos.

## 2. Sessão e login — prioridade alta

O logout original ocultava telas, mas mantinha entradas, campos e identificadores privados na memória (`index.html:488–491`, `555–573`, `803–812`). Uma leitura iniciada para um usuário também podia terminar depois da troca de sessão e substituir o contexto atual (`632–649`).

**Executado:** a saída limpa o diário em memória, formulários, busca, modais e identificadores. Operações exigem usuário atual; carregamentos e respostas de escrita verificam a geração de sessão. Botões de operação impedem repetição imediata e saída enquanto uma gravação está em andamento. O login tem mensagens específicas para cancelamento, rede e domínio não autorizado, sem registrar o e-mail pessoal no console.

**Depois:** testar Google Login no Safari/iPhone real, popup e redirecionamento, e decidir a política de permanência em dispositivos compartilhados. A persistência local de autenticação existente foi preservada; ainda não há bloqueio por inatividade ou opção “não permanecer conectado”.

## 3. Histórico, busca e desempenho — prioridade alta

A consulta original usava `limit(200)` sem paginação (`index.html:631–642`). Busca, recordes, mês e exportação calculavam tudo sobre esse recorte, sem avisar que poderia faltar conteúdo.

**Executado:** páginas de 100 documentos com cursor e deduplicação por ID, botão para buscar registros antigos e indicação explícita de conjunto parcial. Falhas mantêm os registros já carregados e oferecem nova tentativa. Mensagens distinguem permissão, índice necessário e conexão; diário vazio só é mostrado como vazio quando não há falha conhecida.

Busca agora ignora diferença entre letras acentuadas e não acentuadas e combina área, texto e datas inclusivas. O período inválido é sinalizado, e a contagem informa quando o histórico está parcial. O índice necessário foi descrito em `docs/firestore.indexes.proposed.json`, sem criar índices de produção.

**Depois:** carregar diretamente o período consultado e evitar renderizar uma lista muito grande de uma vez. Para históricos extensos, considerar agregações e busca indexada. O filtro separado por tipo de registro permanece no roadmap; hoje os registros têm a mesma estrutura editorial.

## 4. Integridade entre abas e dispositivos — ainda aberta

A criação original sempre chamava `addDoc`, enquanto o bloqueio “já publicou hoje” dependia apenas da primeira entrada local (`index.html:681–686`, `763–782`). Duas abas podiam criar dois registros do mesmo dia. A edição também usava último salvamento sem versão ou precondição (`815–828`), podendo sobrescrever alterações feitas em outra sessão.

**Executado parcialmente:** o cliente busca o registro de hoje em todo o conjunto carregado, direciona para edição e bloqueia ações repetidas em andamento. Isso evita erros imediatos de interface, mas não garante unicidade entre dispositivos.

**Próxima implementação:** definir uma data civil canônica, introduzir um identificador determinístico por usuário/dia com transação e proteger edições com versão ou precondição. É uma mudança que precisa considerar duplicatas e documentos antigos; não será simulada como resolvida apenas com um botão desabilitado.

## 5. Formulários, rascunho e backup — prioridade média

Criar e editar validavam coisas diferentes. A edição permitia retirar todas as gratidões e não tinha os mesmos limites (`index.html:237–249`, `763–775`, `815–826`). Rascunhos se perdiam após recarregar, e palavra/áreas não podiam ser editadas.

**Executado:** esquema compartilhado: manchete até 120 caracteres, resumo até 500, palavra até 30, de uma a três gratidões até 200 cada e áreas conhecidas sem duplicação. Erros levam foco ao campo pertinente. Palavra e áreas são editáveis; falhas de gravação mantêm o formulário.

O rascunho usa `sessionStorage`, isolado por usuário e caminho. Resiste a recarregamento na mesma aba e é removido ao sair. Não é criptografado, não é backup e não sobrevive garantidamente ao fechamento da aba. Evitou-se persistir silenciosamente um diário privado por tempo indefinido no dispositivo.

O backup JSON é baixado por ação explícita, informa se está parcial e contém conteúdo pessoal. **Restauração/importação ainda não foi implementada.** O próximo ciclo pode acrescentar recuperação validada, exportação por período e armazenamento privado opt-in.

## 6. Roda da Vida e relatórios — prioridade média

O gráfico original contava marcações de áreas e normalizava tudo pela maior frequência semanal (`index.html:906–950`). Isso não era uma avaliação de satisfação. O “histórico” mostrava apenas as cinco maiores sequências, e “destaques” eram as três entradas mais recentes (`731–741`, `882–893`).

**Executado:** nomes coerentes com os dados, frequências com denominador, todas as áreas na legenda, relatório acessível por texto e gráfico adaptado a densidade de pixels. A seção agora identifica as cinco maiores sequências e manchetes recentes. O mês exibe palavra do dia, e os indicadores distinguem dias, gratidões e áreas.

A nuvem continua representando palavras das gratidões, agora com normalização Unicode, pontuação e exclusão de palavras comuns em português. Não se afirmou que ela represente o campo Palavra do dia.

**Depois:** avaliações opcionais de satisfação por área, escala fixa de 0 a 10, comparação entre períodos e evolução temporal. Esses dados devem ser separados das marcações de frequência atuais. Também podem entrar seleção de semana anterior e um resumo mensal de tendências, sem alegar aconselhamento de saúde.

## 7. Datas e sequências — correção iniciada

As sequências originais comparavam meias-noites locais por exatamente 86.400.000 milissegundos (`index.html:707–755`), uma suposição que falha em mudanças de horário de verão. Um timestamp ausente virava a data atual (`998–999`), fabricando um registro “de hoje”.

**Executado:** datas ausentes ou inválidas não viram hoje; sequências comparam dias de calendário, ignoram registros duplicados do mesmo dia e atravessam mudanças de mês, ano e horário de verão. A semana permanece domingo a sábado, agora rotulada; registros futuros não entram no relatório da semana até hoje.

**Depois:** decidir fuso fixo, como `America/Sao_Paulo`, ou preferência do usuário. Esta rodada preserva o calendário local do dispositivo para não reclassificar o histórico silenciosamente. Viagens e mudanças de fuso continuam exigindo uma regra de produto explícita. Documentos sem `createdAt` também devem ser identificados em uma revisão autorizada do banco; a consulta ordenada pode não retorná-los.

## 8. iPhone e acessibilidade — prioridade média

A versão original restringia zoom, usava chips como `div` clicável, não associava rótulos a vários campos e não gerenciava foco dos modais (`index.html:5`, `233–268`, `355–385`). Havia textos pequenos com contraste insuficiente e nenhuma reserva explícita para áreas seguras.

**Executado:** zoom e `viewport-fit`, insets de área segura, controles com alvos mínimos de 44 pixels, rótulos maiores na navegação, foco visível, estados `aria-pressed`, regiões de status, diálogos nomeados, Escape, contenção e retorno de foco. Foram mantidas as fontes, o papel claro/escuro e a paleta editorial com tons mais legíveis.

**Depois:** testar teclado virtual, rotação, modo instalado, zoom de 200%, VoiceOver e Safari real. Mocks e CSS revisado não comprovam o comportamento em todos os dispositivos. Não houve screenshot nem medição Lighthouse nesta rodada.

## 9. PWA, offline e atualização — prioridade alta para o cache

O service worker original apagava todo cache da origem cujo nome fosse diferente de `chama-v1` (`sw.js:13–17`). Isso podia afetar outros apps no mesmo domínio GitHub Pages. Pré-carregava só três URLs e dependia de Firebase remoto para iniciar o app. Pedia notificação sem implementar a entrega (`index.html:1014–1016`).

**Executado:** namespace por escopo, limpeza restrita ao próprio app, caminhos relativos para raiz ou subpasta, todos os módulos locais no shell, nenhum cache de respostas Firebase e nenhum pedido automático de notificação. O manifesto preserva nome, cores e ícones existentes. A nova versão é tratada por uma política de atualização, sem recarregar uma gravação em andamento.

**Limite:** shell e demonstração podem funcionar sem rede depois da instalação; login e diário real continuam dependendo da conexão. Não há sincronização de escritas offline ou cache persistente privado do Firestore. Persistência de dados no dispositivo deve ser uma escolha clara, com política de privacidade e testes de suporte, não uma mudança silenciosa.

## 10. Código, dependências e publicação — prioridade média

O original concentrava estilos, telas, integração e cálculos em um HTML, sem testes ou CI. O README citava um projeto Firebase diferente do configurado no app.

**Executado:** módulos separados, testes Node sem dependências adicionais, documentação corrigida e propostas Firebase versionadas. A configuração Pages foi consultada: publica `main`, pasta raiz. A entrega de revisão não deve mudar essa origem nem fazer merge automático.

**Depois:** empacotar e atualizar o Firebase com versões travadas, manter testes de regressão, automatizar validação em Actions e migrar o deploy Pages de forma controlada. Não há motivo para trocar Firebase ou refazer o app em outro framework só por organização. A revisão atual conserva seus dados e seu fluxo de hospedagem.

## Próxima etapa recomendada

Primeiro, revisar a demonstração e verificar no Firebase Console as regras reais, índice e domínio de autenticação. Em seguida, testar a versão de revisão em uma configuração segura e no iPhone. Só então mesclar a primeira rodada no GitHub Pages.

O ciclo seguinte deve garantir unicidade diária e proteção de edições concorrentes, escolher o fuso, permitir avaliações temporais da Roda da Vida e implementar restauração validada do backup. Lembretes, rotinas agendadas e reflexões por IA não foram selecionados e não foram adicionados.

## References

[1]: https://firebase.google.com/docs/firestore/security/insecure-rules "Firebase — preservação do proprietário e revisão de regras inseguras"
[2]: https://firebase.google.com/docs/firestore/security/rules-fields "Firebase — validação de campos e controle de atualizações"
