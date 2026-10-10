# Portal do cliente

O portal é onde o contato de um cliente acompanha os projetos dele com a Harmony. Ele vê a camada estratégica (e a tática, quando o item estiver marcado para o cliente), com os textos escritos para ele. Nunca vê tarefas, textos internos, agentes nem projetos em revisão ou arquivados.

Estado em 2026-10-10 (M6): acesso por convite e a lista de projetos do cliente (PR #51); a página de cada projeto, com as entregas, as frentes e os relatórios publicados, e o teste automático de vazamento (PR #52). O canal de comentários, os arquivos entregues e o confirmar recebimento vêm nos próximos passos do M6.

## O que o contato vê hoje

Em `/portal/<cliente>`, depois de entrar:

- cada projeto ativo do cliente, com o nome, a fase, o objetivo escrito para o cliente (`objective_client`), o andamento (o mesmo cálculo da equipe) e a entrega final prevista;
- a próxima entrega: o primeiro marco ainda não entregue que esteja marcado para o cliente e tenha o título para ele (`title_client`), com a data prevista.

Em `/portal/<cliente>/<código do projeto>`, a página do projeto:

- a fase (Descobrir, Validar, Escalar, com a atual em destaque), o objetivo para o cliente, o andamento e a entrega final prevista;
- as **entregas** (marcos marcados para o cliente e com o título para ele), em ordem: o estado para o cliente (Prevista, Em andamento, Entregue ou Concluída; o aceite continua do dono, D9), a data vigente e quantas vezes ela foi revista, nunca o motivo (RF-11), ou o dia da entrega;
- em cada entrega, as **frentes de trabalho** marcadas para o cliente, com o título e a descrição para ele e o andamento (sem o estado interno da frente, como pede o PRD §9); frente para o cliente sem um marco que ele veja aparece em "Outras frentes de trabalho";
- os **relatórios de andamento** publicados para o cliente (rascunho do agente aprovado pelo dono), do mais novo para o mais antigo.

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

## Teste de vazamento (PRD §5.2 e §9)

Roda no `npm test` e no CI, com a sessão de verdade de um contato:

- **Pela RLS, tabela por tabela** (`app/src/modules/portal/leak.test.ts`): o contato só consegue ler as tabelas do portal (o próprio workspace, o próprio perfil e cadastro, o cliente, os projetos, os marcos, as frentes, os comentários, os arquivos e os relatórios), e nelas só o que é dele e está marcado para ele. Tabela nova que o cliente consiga ler reprova o teste até alguém decidir que pode. O teste confere também que o lado interno existe de verdade (tarefas, aprovações, avisos, histórico, agentes e chaves), para não passar por falta de dados.
- **Pelas leituras do portal:** no cenário do teste, todo texto interno leva a marca INTERNO; a lista de projetos e a página do projeto não podem trazer a marca, nenhum código de tarefa (`HUB-n`) nem nome de agente.
- **No navegador** (`app/e2e/portal.spec.ts`): a página do projeto de exemplo mostra as entregas e as frentes marcadas para o cliente e não mostra frentes internas, tarefas, agentes, o objetivo interno nem códigos de tarefa; com a revisão de acessibilidade (axe) de cada página do portal.

## Ainda não (próximos passos)

- O canal de comentários do projeto, os arquivos entregues e o confirmar recebimento de marco (quando o projeto ligar a opção).
- O convite por e-mail pelo próprio Hub, e o contato pedir um link novo sozinho pelo e-mail: dependem do envio de e-mail (Resend), que o Fábio configura.
- A identidade do portal com a cor de destaque do cliente.

## Onde está no código

- Banco: `supabase/migrations/hub_gestao_0015_portal_access.sql` (acesso) e `hub_gestao_0016_portal_milestone_revisions.sql` (contagem de revisões de data).
- Núcleo: `app/src/modules/portal/access.ts` (contatos, liberar, gerar link, revogar) e `views.ts` (leituras do portal); sessão em `app/src/lib/portal/session.ts` e `token.ts`.
- Telas: `app/src/app/portal/` (entrar, aceite, projetos, a página de cada projeto em `[cliente]/[codigo]`, sair, sem acesso; as peças comuns em `_ui/`) e `app/src/app/(interno)/clientes/[slug]/portal/` (a tela da equipe).
- Testes: `app/src/modules/portal/portal.test.ts` (o caminho completo do acesso no banco), `leak.test.ts` (o teste de vazamento), `form.test.ts` da tela da equipe e `app/e2e/portal.spec.ts` (o dono libera, o contato entra num navegador sem a sessão da equipe, aceita, vê os projetos e a página do projeto sem nada interno, sai; o link não vale de novo; o dono revoga; com a revisão de acessibilidade das páginas do portal).
