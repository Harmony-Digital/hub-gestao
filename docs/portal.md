# Portal do cliente

O portal é onde o contato de um cliente acompanha os projetos dele com a Harmony. Ele vê a camada estratégica (e a tática, quando o item estiver marcado para o cliente), com os textos escritos para ele. Nunca vê tarefas, textos internos, agentes nem projetos em revisão ou arquivados.

Estado em 2026-10-10 (M6): acesso por convite e a lista de projetos do cliente (PR #51); a página de cada projeto, com as entregas, as frentes e os relatórios publicados, e o teste automático de vazamento (PR #52); a conversa do projeto entre o cliente e a equipe (PR #53); os arquivos entregues (PR #54); o confirmar recebimento de entrega (PR #55).

## O que o contato vê hoje

Em `/portal/<cliente>`, depois de entrar:

- cada projeto ativo do cliente, com o nome, a fase, o objetivo escrito para o cliente (`objective_client`), o andamento (o mesmo cálculo da equipe) e a entrega final prevista;
- a próxima entrega: o primeiro marco ainda não entregue que esteja marcado para o cliente e tenha o título para ele (`title_client`), com a data prevista.

Em `/portal/<cliente>/<código do projeto>`, a página do projeto:

- a fase (Descobrir, Validar, Escalar, com a atual em destaque), o objetivo para o cliente, o andamento e a entrega final prevista;
- as **entregas** (marcos marcados para o cliente e com o título para ele), em ordem: o estado para o cliente (Prevista, Em andamento, Entregue ou Concluída; o aceite continua do dono, D9), a data vigente e quantas vezes ela foi revista, nunca o motivo (RF-11), ou o dia da entrega;
- em cada entrega, as **frentes de trabalho** marcadas para o cliente, com o título e a descrição para ele e o andamento (sem o estado interno da frente, como pede o PRD §9); frente para o cliente sem um marco que ele veja aparece em "Outras frentes de trabalho";
- os **relatórios de andamento** publicados para o cliente (rascunho do agente aprovado pelo dono), do mais novo para o mais antigo;
- os **arquivos entregues** pela equipe, com o tamanho e a data, para abrir (imagem e PDF) ou baixar;
- a **conversa com a equipe** (o canal do cliente no projeto): as mensagens dos dois lados e o campo "Escreva para a equipe".

Marco sem o título para o cliente não aparece (o texto interno nunca entra no lugar). Projeto em revisão (importação ainda não aprovada), arquivado ou de outro cliente responde "Projeto não encontrado". O texto interno também não aparece: as leituras do portal escolhem os campos um a um (`app/src/modules/portal/views.ts`), e a RLS só devolve o que é do cliente. A contagem de revisões de data vem de uma função própria do banco (migração 0016), porque o histórico de datas, com o motivo, é só da equipe.

## Acesso (D9: só por convite, só o dono libera)

Tela da equipe: **Clientes → abrir o cliente → Contatos e portal** (`/clientes/<cliente>/portal`).

1. **Cadastrar o contato** (dono ou administração): nome, e-mail e o que ele pode fazer: "Acompanha os projetos" (`client_viewer`) ou "Decisor: também confirma o recebimento de marcos" (`client_approver`, quando o projeto ligar essa opção). O contato nasce **sem acesso**.
2. **Liberar acesso** (só o dono): o Hub gera um link de uso único, válido por 7 dias, que aparece **uma vez só**, com o botão Copiar. O dono manda ao contato por onde preferir (WhatsApp, e-mail). Liberar o primeiro contato liga o portal daquele cliente.
3. **O contato abre o link** e clica em **Entrar no portal**. Só o clique gasta o link: a prévia que o WhatsApp ou o e-mail geram ao receber o link não gasta.
4. **Primeiro acesso:** o contato lê e aceita o uso dos dados (LGPD). O aceite fica registrado com a data (`consent_at`) e no histórico (`portal.consent_given`).
5. **Sessão curta:** depois de 12 horas sem uso, a sessão termina; cada uso empurra o fim, até 7 dias desde a entrada. Para voltar, o contato pede um link novo. **Sair** encerra a sessão na hora.
6. **Gerar novo link** (só o dono): o link anterior que ainda não foi usado deixa de valer.
7. **Revogar acesso** (só o dono, com confirmação): encerra as sessões abertas e anula os links pendentes na hora. Liberar de novo devolve o acesso.

A tela mostra, para cada contato: a situação (Sem acesso; Link enviado, ainda não entrou; Com acesso; Acesso revogado), quando foi liberado, quando aceitou o uso dos dados, o último acesso e até quando vale o link ainda não usado.

## Segurança

- **Sem conta no Supabase Auth para o cliente.** O Auth compartilhado da Harmony tem o cadastro fechado e o Hub não guarda a chave de administração dele. O contato ganha um perfil próprio no Hub (o id dele no portal), sem vínculo com a equipe.
- **No banco ficam só os hashes** do link e da sessão (HMAC-SHA256 com o `HUB_API_KEY_PEPPER`, com o prefixo `portal:`). O link em claro aparece uma vez, para o dono copiar; o valor da sessão vive só no cookie. O histórico guarda o fato e a validade, nunca o link.
- **Cookie `hub_portal`:** só no caminho `/portal`, `HttpOnly`, `Secure` em produção e `SameSite=Lax`. O cookie dura no máximo 7 dias; quem decide se a sessão ainda vale é o banco.
- **Funções do banco (migração 0015):** `redeem_client_access_link`, `client_for_portal_session`, `record_client_consent` e `end_client_session` rodam antes de existir contexto de ator, como `SECURITY DEFINER` com `search_path` vazio, e só o papel do app (`hub_gestao_app`) pode chamá-las. Elas conferem tudo: link sem uso e no prazo, contato com acesso liberado, cliente com o portal ligado e não arquivado.
- **Depois de entrar, tudo roda com o ator de cliente** (`scope = client`): a RLS mostra só os projetos do cliente e os itens marcados para ele.
- **E-mail de alguém da equipe não vira contato com acesso:** o cadastro do contato e o Liberar acesso recusam (o ator do portal tem o id do perfil, e o histórico do contato não pode sair em nome da equipe).
- **Agente nunca libera nem revoga** (D9): a permissão `portal.manage` é só do dono, e as tabelas `client_access_links` e `client_sessions` têm a trava `agent_never_writes`.
- **Rotas `/portal/*`:** fora da porta de login da equipe (`app/src/proxy.ts`), fora dos buscadores (`noindex` na página e no cabeçalho `X-Robots-Tag`), `Referrer-Policy: no-referrer` (o link não vaza para outros sites) e `Cache-Control: private, no-store`. Sem rastreadores de terceiros.

## Conversa com a equipe (canal do cliente)

- **O cliente escreve** no fim da página do projeto. A mensagem vai por uma função do banco (`post_client_comment`, migração 0017) que confere tudo a partir da sessão: sessão válida, contato com acesso e com o aceite do uso dos dados, projeto do cliente fora de revisão, texto de 1 a 4000 caracteres e **no máximo 20 mensagens por hora** por contato. A mensagem fica em nome do contato, e o histórico também.
- **A equipe é avisada:** os donos e o responsável pelo projeto recebem o aviso na caixa de entrada ("Mensagens dos clientes no portal", que dá para desligar nas preferências), e os webhooks que assinam "Cliente escreveu no portal" (`client.commented`) recebem o evento, para o Telegram pelo Hermes (`docs/webhooks.md`).
- **A equipe responde** na Visão geral do projeto, na seção "Canal do cliente" (aparece quando o cliente tem o portal ligado ou já há mensagens). Responder é do dono ou da administração (a mensagem vai para o cliente, com o nome de quem escreveu); a equipe comum lê. Agente não escreve no canal: o banco recusa, e a mensagem de agente para o cliente passa por aprovação (PRD §5.2).
- Conversa interna e comentários de tarefa nunca aparecem no canal: o canal mostra só as mensagens marcadas para o cliente, no projeto.
- O cliente ainda não recebe e-mail quando a equipe responde: vê a resposta ao entrar no portal. O aviso por e-mail depende do Resend (Fábio).

## Arquivos entregues

- **A equipe entrega** na Visão geral do projeto, na seção "Arquivos entregues ao cliente" (aparece quando o cliente tem o portal ligado ou já há arquivos). Entregar e tirar é do dono ou da administração (ação `attachment.write_client`; a equipe comum vê e abre); agente não entrega (o banco recusa). Mesmas regras dos anexos das tarefas: até 10 MB, só tipos comuns de trabalho (imagem, PDF, texto, CSV, planilha, documento, zip), conferidos pelos primeiros bytes; até 50 arquivos por projeto.
- **O cliente baixa** pela página do projeto, por um endereço do próprio portal (`/portal/<cliente>/<código>/arquivos/<id>`), que exige a sessão do cliente e lê com o ator de cliente: a RLS só entrega o conteúdo dos arquivos marcados para ele. Imagem e PDF abrem no navegador; o resto baixa; nada é interpretado como página (`nosniff`, `no-store`).
- Tirar o arquivo tira do portal na hora; o histórico guarda quem entregou e quem tirou, com o nome do arquivo.

## Confirmar recebimento (D9)

- **Opção por projeto**, desligada por padrão: em Editar projeto, "O cliente pode confirmar o recebimento das entregas no portal (o aceite do marco continua com você)".
- Com a opção ligada, o contato **decisor** ("Decisor: também confirma o recebimento de marcos") vê **Confirmar recebimento** em cada entrega já entregue ou concluída, com a pergunta antes ("Confirmar que você recebeu esta entrega?"). Quem só acompanha não vê o botão.
- A confirmação passa por uma função do banco (`confirm_milestone_receipt`, migração 0018) que confere tudo a partir da sessão: contato decisor com acesso e com o aceite do uso dos dados, projeto do cliente com a opção ligada, entrega visível ao cliente e ainda sem confirmação. Grava quando e quem (o nome do contato fica no marco) e o histórico, em nome do contato.
- **Não é o aceite:** o aceite do marco continua do dono (D9) e não muda com a confirmação.
- A equipe vê "Recebimento confirmado pelo cliente (nome) em dd/mm" no marco, na Visão geral, e pela API (`client_received_at` e `client_received_by` do marco); os donos recebem o aviso na caixa de entrada e os webhooks que assinam `client.receipt_confirmed` recebem o evento.

## Texto para o cliente: verificação do Redator do Cliente (RC-12)

Antes de um texto escrito por agente ir para o portal, o Hub confere o que nunca deve aparecer para o cliente: **código de tarefa** (HUB-n), **nome de agente** do workspace, **ferramenta interna** (Kratos, Hermes, Claude, Codex, GitHub, Supabase, MCP e outras), **código de commit**, **pedido de código** (PR #n), **valor em dinheiro** e **nome de outro cliente**. É regra em código, sem IA (`app/src/modules/client-text/check.ts`): vale sempre, inclusive sem chave de IA.

- **Rascunho de status para o cliente** (`hub_draft_status_report`, do Relator RL-03): o agente recebe os alertas na resposta (`checks`) e pode mandar uma versão corrigida; a versão nova substitui a anterior dele ainda pendente do mesmo período, e todas ficam guardadas. O pedido no Hoje e nas Aprovações mostra os alertas e o texto do relatório ("Ver o texto do relatório"), para o Fábio decidir sabendo o que vai ao portal.
- **Mostrar uma frente ao cliente** (pedido do tipo "Mostrar ao cliente"): o título e a descrição propostos passam pela mesma verificação; os alertas aparecem no pedido.
- Os alertas não bloqueiam: quem decide é o Fábio (Aprovar, Ajustar ou Recusar). Campos que só o Hub preenche no pedido (os alertas e o texto do relatório) são descartados se vierem de fora.
- **Reescrita pela IA do Redator do Cliente (RC-12)**: com um agente ativo com o papel RC-12, a chave de IA e o modelo (Sala de Controle), cada rascunho de status para o cliente e cada pedido de mostrar frente ao cliente vão para uma fila; o relógio (de 5 em 5 minutos) reescreve o texto no tom Harmony (prompt `RC-12/redigir`, versionado), roda a verificação de novo no texto novo e atualiza o pedido: o relatório ganha uma versão nova, do Redator, e a de quem preparou fica guardada; na frente, o título e a descrição propostos são trocados, guardando os originais. O cartão de decisão diz "Reescrito pelo Redator do Cliente (RC-12)", com a nota dele e "Ver o texto como veio de quem preparou". Aprovar publica a versão reescrita. Sem o agente, sem IA, com o pedido já decidido ou com qualquer falha da IA, o pedido segue como estava (falha fechada).

## Teste de vazamento (PRD §5.2 e §9)

Roda no `npm test` e no CI, com a sessão de verdade de um contato:

- **Pela RLS, tabela por tabela** (`app/src/modules/portal/leak.test.ts`): o contato só consegue ler as tabelas do portal (o próprio workspace, o próprio perfil e cadastro, o cliente, os projetos, os marcos, as frentes, os comentários, os arquivos e os relatórios), e nelas só o que é dele e está marcado para ele. Tabela nova que o cliente consiga ler reprova o teste até alguém decidir que pode. O teste confere também que o lado interno existe de verdade (tarefas, aprovações, avisos, histórico, agentes e chaves), para não passar por falta de dados.
- **Pelas leituras do portal:** no cenário do teste, todo texto interno leva a marca INTERNO; a lista de projetos e a página do projeto não podem trazer a marca, nenhum código de tarefa (`HUB-n`) nem nome de agente.
- **No navegador** (`app/e2e/portal.spec.ts`): a página do projeto de exemplo mostra as entregas e as frentes marcadas para o cliente e não mostra frentes internas, tarefas, agentes, o objetivo interno nem códigos de tarefa; com a revisão de acessibilidade (axe) de cada página do portal.

## Ainda não (próximos passos)

- O convite por e-mail pelo próprio Hub, e o contato pedir um link novo sozinho pelo e-mail: dependem do envio de e-mail (Resend), que o Fábio configura.
- A identidade do portal com a cor de destaque do cliente.

## Onde está no código

- Banco: `supabase/migrations/hub_gestao_0015_portal_access.sql` (acesso), `hub_gestao_0016_portal_milestone_revisions.sql` (contagem de revisões de data) e `hub_gestao_0017_portal_client_channel.sql` (o cliente escreve no canal) e `hub_gestao_0018_portal_milestone_receipt.sql` (confirmar recebimento).
- Núcleo: `app/src/modules/portal/access.ts` (contatos, liberar, gerar link, revogar) e `views.ts` (leituras do portal); sessão em `app/src/lib/portal/session.ts` e `token.ts`; o canal em `app/src/modules/comments/client-channel.ts` (leitura e resposta da equipe e o aviso); os arquivos em `app/src/modules/attachments/client-files.ts`.
- Telas: `app/src/app/portal/` (entrar, aceite, projetos, a página de cada projeto em `[cliente]/[codigo]`, sair, sem acesso; as peças comuns em `_ui/`) e `app/src/app/(interno)/clientes/[slug]/portal/` (a tela da equipe).
- Testes: `app/src/modules/portal/portal.test.ts` (o caminho completo do acesso no banco), `leak.test.ts` (o teste de vazamento), `form.test.ts` da tela da equipe e `app/e2e/portal.spec.ts` (o dono libera, o contato entra num navegador sem a sessão da equipe, aceita, vê os projetos e a página do projeto sem nada interno, sai; o link não vale de novo; o dono revoga; com a revisão de acessibilidade das páginas do portal).
