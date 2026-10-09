# PLAN.md — Plano de Ação e Checklist de Execução · Hub de Gestão

> **Nota de 09/10/2026:** o produto chamado RELGOV neste documento passou a se chamar **Certato** (decisão dos sócios). As menções a RELGOV abaixo se referem ao mesmo sistema; repositório, VPS, contêineres e banco mantêm o nome técnico `relgov` até uma migração planejada.

> **Este arquivo é o estado vivo do projeto.** Toda IA (Claude Code, Codex, Hermes ou outra) e toda nova sessão deve: **(1)** ler `AGENTS.md`, `PRD.md` e `AGENTES.md`, **(2)** abrir este arquivo para ver o que já foi feito e o que vem a seguir, **(3)** executar a próxima tarefa pendente do milestone atual, e **(4)** marcar aqui o que concluiu, com evidência.

## Regras de uso deste checklist

1. Marque `[x]` **somente** quando a tarefa estiver concluída **e verificada** (código rodando, consulta feita, teste passando, URL respondendo). Trabalho parcial permanece `[ ]` com nota `⏳ em andamento — <detalhe>`.
2. Itens **🔒 GATE** são o aceite do milestone e **só o Fábio pode aprovar**. A IA prepara a demonstração e pede a validação. Nunca marque um gate por conta própria.
3. Não reordene, não apague e não reescreva tarefas. Se o escopo mudar, adicione a tarefa nova e anote no **Registro de Execução**.
4. **Não pule milestones**: a ordem M0 → M9 espelha as dependências do PRD. Não antecipe escopo sem pedido explícito do Fábio.
5. Toda tarefa que mexe em infraestrutura (VPS, DNS, Traefik, Compose, segredos) só começa com autorização explícita registrada aqui ou no chat.
6. Ao terminar qualquer sessão, adicione uma linha no **Registro de Execução** (data, IA/sessão, o que foi entregue, pendências deixadas).
7. Uma sessão de IA por vez neste repositório.
8. Quando o Hub estiver no ar, **este arquivo passa a ser sincronizado pelo próprio Hub** (`hub plan pull|push`, projeto `HUB`). As regras acima continuam valendo.

## Decisões do Fábio (tomadas em 2026-10-09)

> Respostas do Fábio às decisões D1–D11. Se alguma mudar, registrar a mudança no Registro de Execução sem apagar esta lista.

- [x] **D1** Domínio: `hub.harmonydigital.com.br`. Um endereço mais amigável só para o portal do cliente pode ser somado depois, sem mexer no que estiver pronto.
- [x] **D2** Banco: schema `proj_hub_gestao` no Supabase self-hosted compartilhado da Harmony.
- [x] **D3** Framework: Next.js 16 (App Router), o mesmo do Certato, do IA Posicionamento e da Redação ACM, com o pipeline GitHub Actions → VPS já provado.
- [x] **D4** Tema claro por padrão; "Sala de Controle" escuro no console dos agentes e como opção do usuário.
- [x] **D5** IA multi-provedor por agente: todo agente interno do Hub pode usar **Anthropic (Claude), OpenAI ou xAI (Grok)**. O Fábio troca provedor, modelo e chave de API quando quiser, na tela Agentes, sem deploy. Chaves cifradas no banco. Teto de gasto mantido (inicial de US$ 30/mês somados), editável na mesma tela. Os papéis que rodam no Kratos usam o modelo configurado no Hermes.
- [x] **D6** Agente de gestão: na fase 1, os papéis GP-01 a VP-05 rodam **dentro do Kratos**, como skills dele. Um agente dedicado fica para depois, se o Fábio quiser; no Hub, isso é só trocar a chave.
- [x] **D7** Sem produto comercial por enquanto: **uso interno da Harmony**. Comercializar só depois de validado, por nova decisão do Fábio. M9 adiado; a arquitetura continua preparada para replicação, sem esforço comercial.
- [x] **D8** Backups como recomendado: `pg_dump` diário do schema, snapshot semanal da VPS, cópia fora da VPS e teste mensal de restauração. O backup diário foi antecipado para o M2, antes de existir dado real.
- [x] **D9** Portal do cliente só por convite: entra apenas quem o Fábio cadastrar, e o acesso só é liberado quando ele decidir (convite por e-mail pelo Hub ou link copiado para ele mesmo enviar). O aceite de marco continua com o Fábio; o cliente acompanha.
- [x] **D10** Depois do Hub pronto, **todos os projetos** serão importados por um agente (o Kratos, ou o Claude Code para projetos que só existem no Mac), com orientação do Fábio. Cada projeto entra "Em revisão" até o ok dele, que pode ser dado em lote.
- [x] **D11** Publicar cedo: o Hub vai para o endereço definitivo no M2, protegido por login, mesmo com poucas telas prontas.

## Visão geral do progresso

| Fase | Status |
|---|---|
| Preparação (pasta, documentos de planejamento) | ✅ Concluída em 2026-10-08 |
| M0 — Fundação e decisões | ✅ Concluído e aprovado pelo Fábio em 2026-10-09 |
| M1 — Núcleo para agentes (dados, autorização, REST, MCP, chaves, auditoria) | 🔄 Pronto para o GATE M1 (2026-10-09); o teto de IA fica para o adaptador do M5 |
| M2 — Publicação inicial na VPS | ⬜ |
| M3 — Interface interna essencial | ⬜ |
| M4 — `plan.md`, CLI, GitHub e importação do próprio Hub | ⬜ |
| M5 — Agentes de gestão (Kratos) + Concierge e Planejador + importação de todos os projetos | ⬜ |
| M6 — Portal do cliente e relatórios | ⬜ |
| M7 — Departamentos, visões avançadas, templates, tempo | ⬜ |
| M8 — Operação, segurança, backups, LGPD | ⬜ |
| M9 — Produto replicável | ⏸ Adiado (D7: uso interno) |

---

## ✅ Preparação (concluída em 2026-10-08)

- [x] Levantamento da stack e infraestrutura reais (VPS KVM4 `1821299`, Supabase compartilhado, Traefik, Hermes, pipeline RELGOV) — evidência: inventário read-only por SSH e API da Hostinger em 2026-10-08
- [x] Levantamento da identidade visual (tokens de `Site 2026/styles.css`, brief da marca, fontes)
- [x] Pasta `Projetos de IA/Sistema de Gestão da Harmony Digital/` criada
- [x] `CLAUDE.md` (espelho) · `AGENTS.md` (canônico + Protocolo do Agente Operador) · `PRD.md` (modelo de três camadas, requisitos, stack) · `AGENTES.md` (catálogo) · este `PLAN.md`

---

## M0 — Fundação e decisões

### Decisões e aprovação
- [x] Fábio lê `PRD.md` e responde D1–D11 (ou aceita as recomendações) — respondidas em 2026-10-09 (ver "Decisões do Fábio")
- [x] Ajustar `PRD.md`/`AGENTES.md` conforme as respostas; registrar no Registro de Execução — 2026-10-09: PRD, AGENTES, AGENTS, CLAUDE e este plano ajustados

### Repositório
- [x] Criar repositório privado `Harmony-Digital/hub-gestao` com `GH_TOKEN="$(gh auth token --user fabioalmeidadigital)"` (confirmar `gh api user` → `fabioalmeidadigital` antes) — 2026-10-09: https://github.com/Harmony-Digital/hub-gestao, privado, conta conferida (admin da org)
- [x] Copiar os cinco documentos para a raiz do repo; `README.md` curto apontando para eles — a pasta do projeto é a raiz do repositório; commit 8039d4f
- [x] `.gitignore` (`.env*`, `node_modules`, `.next`, `coverage`, artefatos), `.editorconfig`, `LICENSE` interno (todos os direitos reservados) — commit 8039d4f; varredura de segredos no conteúdo do commit sem achados
- [ ] Proteção da branch `main` (PR obrigatório opcional; sem force-push) — ⛔ indisponível: o plano Free da org recusa proteção de branch e rulesets em repositório privado (HTTP 403, 2026-10-09). Até um eventual upgrade, vale o controle por processo do `AGENTS.md` (nunca `--force`)

### Bootstrap do app (`app/`)
- [x] Next.js 16 (App Router, TypeScript estrito) + Tailwind v4 + shadcn/ui + lucide-react; `output: 'standalone'` — Next.js 16.4.0 com Cache Components e Partial Prefetching (padrões da versão), shadcn estilo radix-nova, lucide-react 1.54; `.next/standalone/server.js` gerado e servido em produção local
- [x] Scripts `lint`, `typecheck`, `test` (Vitest + Testing Library), `build`, `check`; ESLint + Prettier — `check` = formato + lint + tipos (`next typegen` + `tsc`) + Vitest + build; verde local, em clone limpo e no CI. Testing Library e jsdom entram no M3, com os testes de componentes (hoje conflitam com o babel do instalador do shadcn)
- [x] Tokens Harmony em `src/styles/tokens.css` (tema claro padrão + escuro "Sala de Controle"); fontes Sora, DM Sans, JetBrains Mono via `next/font` — os tokens ficaram em `app/src/app/globals.css` (padrão do Tailwind v4 com shadcn); fontes conferidas no navegador
- [x] Página inicial provisória com o nome do produto e `/api/health` retornando `{ ok, version }` — saúde com HTTP 200, `Cache-Control: no-store` e cálculo a cada pedido; página conferida no desktop e em 375 px, sem rolagem lateral e sem erros no console
- [x] `app/.env.example` com todas as variáveis (sem valores) e `docs/credenciais.md` explicando onde cada uma vive
- [x] `app/AGENTS.md` curto com comandos e convenções locais — mantém o bloco do Next.js e acrescenta as regras do app; `app/CLAUDE.md` aponta para ele

### Banco (Supabase compartilhado)
- [x] Preflight read-only: MCP `harmony-supabase-readonly` → listar `harmony_admin.projects` e confirmar que `hub-gestao` **não** existe — 2026-10-09: túnel religado (LaunchAgent `com.harmonydigital.supabase-mcp-tunnel`) e servidor MCP respondendo; o catálogo tem 4 projetos (ia_posicionamento, sistema_rh_carla_mileia, sistema_relgov, harmony_digital) e não tem `hub_gestao`; não existe schema `proj_hub_gestao`. A função `create_project(p_slug, p_display_name, p_client_name)` foi lida: cria o schema se não existir, dá acesso ao `service_role` e leitura ao `supabase_read_only_user` e grava no catálogo, sem apagar nada. O slug precisa ser `hub_gestao` (só minúsculas, números e sublinhado)
- [x] Com autorização do Fábio: `harmony_admin.create_project('hub-gestao', …)` → schema `proj_hub_gestao`; registrar o retorno aqui — 2026-10-09 17:50 UTC, pelo MCP `harmony-supabase` da sessão, depois de o Fábio reconectar o conector: `select harmony_admin.create_project('hub_gestao', 'Hub de Gestão', 'Harmony Digital')` retornou `proj_hub_gestao`. Conferido: linha no catálogo (status prototype), dono `postgres`, `USAGE` para `service_role` e `supabase_read_only_user`, sem acesso de `anon` e `authenticated`, 3 regras de privilégio padrão, schema vazio. Avisos de segurança do banco: nenhum sobre `proj_hub_gestao` (os existentes são de outros projetos e não foram tocados)
- [x] Confirmar política de exposição do schema no PostgREST (decidir: UI via `supabase-js` com RLS, ou só server-side) — decisão técnica de 2026-10-09: no M1, o navegador não fala direto com o banco; tudo passa pelo servidor do Hub, com `authorize()`, e a RLS fica ligada como segunda linha. O schema não é exposto no PostgREST. Reavaliar no M3, se o quadro em tempo real precisar do Realtime com o papel `authenticated`

### CI
- [x] `.github/workflows/ci.yml`: `npm ci`, lint, typecheck, test, build em PR e `main` — mais conferência de formato; executor fixado em `ubuntu-24.04`
- [x] Badge/status no README; primeira execução verde — run 37958296836 verde no commit 8039d4f

### 🔒 GATE M0 (aprovação do Fábio)
- [x] PRD e decisões aprovados — aprovado pelo Fábio no chat em 2026-10-09, junto com o protótipo: “Perfeito, tá aprovado. Vamos iniciar a construção.”
- [x] Repositório criado, CI verde, schema registrado — aprovado pelo Fábio no chat em 2026-10-09: “Pode continuar.” Ele confirmou que todos os projetos do Supabase compartilhado estão em validação e que o Hub segue na área dele, do jeito que está

---

## M1 — Núcleo para agentes (dados, autorização, REST, MCP, chaves, auditoria)

> Objetivo: um agente consegue criar, iniciar e concluir tarefa por MCP e por REST, com auditoria completa, **antes** de existir interface.

### Modelo de dados
- [x] `hub_gestao_0001_foundation.sql`: enums; `workspaces`, `profiles`, `memberships`, `clients`, `client_contacts`, `departments`; funções `has_workspace_access`, `has_project_access`, `is_client_of_project`; RLS — 2026-10-09, aplicada no banco compartilhado (versão 20261009181320). O acesso usa o contexto do ator, gravado pelo servidor em cada transação: `current_workspace_id()`, `current_actor_id()`, `current_actor_type()`, `current_client_id()`, `actor_is_internal()` e `actor_is_client()`. Sem contexto, nada aparece. O papel dentro do projeto (`has_project_access`) é conferido no `authorize()` do servidor; `is_client_of_project` virou `project_visible_to_client()`, na 0002
- [x] `hub_gestao_0002_work.sql`: `projects`, `project_departments`, `project_members`, `project_agents`, `milestones`, `milestone_date_history`, `workstreams`, `workstream_dependencies`, `task_statuses`, `tasks` (+ sequence `HUB-n` via `fn_next_task_code`), `task_dependencies`, `labels`, `task_labels`, `checklist_items`, `comments`, `attachments`, `time_entries`; RLS — 2026-10-09, aplicada (20261009181653). O código `HUB-n` sai de `next_task_code()`, com contador no workspace. A trava da tarefa recusa concluir sem evidência quando o projeto exige e mantém data de conclusão e versão. `project_agents` ficou de fora por engano e entrou na 0007
- [x] `hub_gestao_0003_agents_governance.sql`: `agents`, `agent_api_keys`, `agent_runs`, `approvals`, `status_reports`, `notifications`, `notification_prefs`, `webhooks`, `webhook_deliveries`, `activity_log` (append-only), `idempotency_keys`, `jobs`, `plan_sync_runs`, `saved_views`, `project_templates`; RLS — 2026-10-09, aplicada (20261009181800). Inclui `llm_credentials` (D5) e as consultas de autenticação `agent_key_lookup()` e `workspace_id_by_slug()`, sem acesso público. O registro de atividades recusa alteração e exclusão até para o administrador do banco
- [x] `hub_gestao_0004_rollups.sql`: views `v_workstream_progress`, `v_milestone_progress`, `v_project_health`, `v_department_load`; `fn_rollup_project`; triggers leves de `updated_at` — 2026-10-09, aplicada (20261009181818). Mudança de desenho: o progresso fica gravado em frente, marco e projeto e é recalculado por `recompute_project_rollup()`, porque o cliente precisa ver o percentual sem acesso às tarefas. A saúde usa `v_project_health_inputs` com a regra no servidor. `v_department_load` como previsto; `updated_at` por trigger nas tabelas que mudam
- [x] Aplicar cada migration via `apply_migration` (prefixo `hub_gestao_`), rodar `get_advisors` e registrar achados — 2026-10-09. Primeira rodada, só no schema do Hub: nenhum achado de segurança; de desempenho, 90 avisos de políticas permissivas duplicadas (10 pares tabela e ação, vezes 9 papéis do banco), 54 chaves estrangeiras sem índice e 25 índices ainda sem uso. Corrigidos na 0005. Rodada final, depois da 0007: segurança sem achados no Hub; desempenho só com o aviso informativo de índices sem uso (81), esperado num schema que ainda não recebe consultas. Os avisos de outros schemas não foram tocados
- [x] Seed do workspace Harmony: departamentos padrão (9), status padrão (5), cliente `Harmony Digital (interno)`, projeto `HUB` (este), usuário `owner` = Fábio — 2026-10-09, `supabase/seeds/harmony_workspace.sql` pelo `execute_sql`; idempotente e testado duas vezes seguidas no banco local. Conferido no banco compartilhado: workspace `harmony`, Fábio Almeida como owner, os 9 departamentos do PRD com as cores do protótipo, cliente interno, projeto `HUB` ativo desde 2026-10-08 com o Fábio como líder, e os 5 status com "A fazer" como padrão. Líderes de departamento, departamentos do projeto e fase ficam para o Fábio definir
- [x] `supabase/tests/001_rls_two_workspaces.sql` e `002_rls_client_role.sql` (cliente não lê tarefas nem comentários internos) — feitos como testes automatizados com PGlite (o mesmo Postgres 17) em `app/src/lib/db/schema.test.ts` e `seed.test.ts`, que rodam no CI a cada envio: dois workspaces isolados; cliente sem acesso a tarefas, agentes, aprovações e registro; comentário de cliente só no canal do projeto e em nome próprio; mais os critérios dos alertas do Supabase e as decisões humanas
- [x] `hub_gestao_0005_advisor_hardening.sql` (acrescentada em 2026-10-09) — aplicada. Uma política por tabela e ação; funções de contexto calculadas uma vez por consulta; 54 índices de chave estrangeira. Apertos: o registro de atividades só aceita linha em nome do próprio ator; a equipe só altera perfis ligados ao próprio workspace; o contato de cliente só lê o próprio cadastro; workspace não pode ser apagado pela aplicação
- [x] `hub_gestao_0006_human_decisions.sql` (acrescentada em 2026-10-09) — aplicada. O próprio banco recusa que agente ou sistema decida uma aprovação ou aceite um marco (RF-10 e D9). Só uma pessoa, em nome próprio, decide; decisão registrada não muda depois
- [x] `hub_gestao_0007_project_agents.sql` (acrescentada em 2026-10-09) — aplicada. Liga agente e projeto com o papel do catálogo, como `GP-01`; agente e projeto precisam ser do mesmo workspace
- [x] `hub_gestao_0009_review_hardening.sql` (acrescentada em 2026-10-09, depois da revisão de segurança) — aplicada. Títulos e nomes de uma linha só; um pedido pendente por item e versão de relatório única, mesmo sob concorrência; 16 travas que impedem agente de escrever texto ou visibilidade do cliente, mudar marco (salvo o progresso), alterar pedido de aprovação (salvo cancelar o próprio), publicar relatório ou escrever chaves, credenciais, membros, contatos, perfis e departamentos. Alertas do Supabase depois dela: nenhum de segurança no Hub
- [x] `hub_gestao_0008_jobs_webhooks.sql` (acrescentada em 2026-10-09) — aplicada. O segredo do webhook passa a ser guardado cifrado (é preciso recuperá-lo para assinar as entregas); jobs periódicos com chave de deduplicação; índice das entregas pendentes. Alertas do Supabase depois dela: nenhum de segurança no Hub; de desempenho, só índices ainda sem uso

### Domínio e autorização
- [x] `src/lib/authorize.ts`: `authorize(actor, action, resource)` com matriz de papéis e escopos (PRD §8.2); testes unitários cobrindo cada combinação crítica — 2026-10-09: owner pode tudo; admin não decide gate nem gera chave (D9); member só nos projetos de que participa; agente precisa do escopo e do projeto na chave; decisões nunca são de agente nem do sistema, nem com `workspace:*`; contato de cliente fica no portal. A recusa explica o que falta (`missing_scope`, `human_only`). Testes em `src/lib/authorize.test.ts` e nos testes de integração
- [x] `src/lib/audit.ts`: gravação em `activity_log` (before/after, source, request_id) em toda mutação — toda escrita dos módulos grava ator, papel declarado, origem (`api`, `mcp`, `cron`), antes e depois (só o que mudou) e o id do pedido, na mesma transação. Conferido no banco local depois da demonstração: 10 registros, com origem e papel certos
- [x] `src/lib/idempotency.ts`: `Idempotency-Key` com hash do corpo; `409` em corpo divergente — reserva da chave, mudança e resposta na mesma transação; falha não fica guardada; chave vence em 24 horas e o job `idempotency-cleanup` limpa. Conferido por HTTP: a repetição devolveu a mesma tarefa com `Idempotent-Replayed: true`
- [x] `src/modules/{projects,milestones,workstreams,tasks,comments,approvals,agents}`: casos de uso compartilhados por UI, REST e MCP — mais `reports`, `time`, `today`, `search`, `health`, `jobs` e `mcp`. REST e MCP chamam os mesmos casos de uso
- [ ] Regras: conclusão exige evidência (`require_evidence`); GATE recusado para agentes; visibilidade operacional sempre `internal`; teto de IA — ⏳ três das quatro regras prontas e testadas: evidência obrigatória (serviço e banco), decisão e aceite só de pessoa (autorização e travas da 0006), comentários e frentes de agente sempre internos, texto para cliente só por aprovação. O teto de IA depende do adaptador de IA (item D5 do M5): no M1 o Hub não faz chamadas de IA; o orçamento de cada agente já aparece em `/me` e `hub_whoami`

### Chaves de agente
- [x] Geração `hub_ak_<prefixo>.<segredo>`, hash com pepper, exibição única; `last_used_at`; expiração; revogação — HMAC-SHA256 com `HUB_API_KEY_PEPPER`, comparação em tempo constante, escopos validados (os proibidos recusados no serviço e no banco), `last_used_at` no máximo uma vez por minuto. Criar e revogar são do owner; as telas chegam no M3
- [x] Middleware de autenticação por Bearer para `/api/v1` e `/mcp`; `423 Locked` para agente pausado; rate limit por chave — 401 sem chave, com chave errada, vencida ou revogada; 423 para agente pausado; 429 com `Retry-After` (600 por minuto por padrão). Conferido por teste e por HTTP

### API REST v1
- [x] Rotas do PRD §8.3 (`/me`, `/projects`, `/plan`, `/milestones`, `/workstreams`, `/tasks` + transições, `/comments`, `/time`, `/approvals`, `/reports`, `/today`, `/search`, `/sync/plan`) — 34 operações em 25 caminhos. Exceções combinadas: `POST /sync/plan` responde 501 até o M4; `POST /approvals/{id}/decide` existe, mas com chave de agente responde sempre 403 (a decisão vem pela sessão do Fábio, M3); `/events` (P2) fica para depois
- [x] `zod-openapi` gerando `/api/v1/openapi.json`; teste de snapshot do contrato — gerado dos próprios esquemas zod (`z.toJSONSchema`), sem pacote extra. O teste compara com `docs/api/openapi.v1.json` e confere que cada rota do código está no contrato, e vice-versa
- [x] Erros `problem+json`; paginação por cursor; `ETag`/`If-Match` em `PATCH /tasks` — mensagens e validação em português; cursor com microssegundos para não pular nem repetir linhas; `If-Match` velho dá 412
- [x] Testes de integração com banco (Vitest) para cada rota — `src/app/api/v1/api.test.ts` e `routes.test.ts`, chamando as rotas reais com chaves reais no banco local

### Servidor MCP
- [x] `src/app/mcp/route.ts` com `@modelcontextprotocol/sdk` (Streamable HTTP, sem estado) — uma instância por pedido, com as ferramentas que a chave pode usar e as regras do protocolo nas instruções do servidor
- [x] Tools do PRD §8.4 com descrições PT-BR distintas; resources `hub://projects/{code}/plan.md`, `hub://today`; prompts `status-semanal`, `digest-matinal`, `revisar-conclusoes` — 22 ferramentas, mais o recurso `hub://projects/{code}/health`. `hub_create_client`, `hub_create_project` e `hub_import_plan` chegam com a importação do M5
- [x] Teste automatizado da lista de tools (snapshot) e de autorização por tool — `docs/mcp/tools.v1.json`; chave só de leitura vê 4 ferramentas; fora do escopo, a ferramenta responde com erro explicado sem derrubar a sessão
- [x] Teste manual: Claude Code registra o servidor e executa `hub_whoami` → `hub_create_task` → `hub_start_task` → `hub_complete_task` com evidência → registro visível em `activity_log` — 2026-10-09, servidor local: uma sessão do Claude Code 2.1.294 só com o MCP do Hub criou e concluiu HUB-3 em 5 turnos (US$ 0,17), com evidência; antes, a API REST concluiu HUB-1 e o cliente MCP do SDK concluiu HUB-2. O registro mostra as três tarefas com origem, ator e papel, e o projeto HUB local com 100%. Reteste depois da revisão de segurança, com `idempotency_key` obrigatória: o Claude Code concluiu HUB-4 em 5 turnos (US$ 0,18), gerando uma chave por escrita, e o último uso da chave ficou registrado

### Jobs
- [x] Tabela `jobs` + worker `src/modules/jobs` (`FOR UPDATE SKIP LOCKED`); endpoint `POST /api/internal/cron/tick` com `CRON_SECRET`; jobs `health-rollup`, `approval-aging`, `webhook-dispatch` — mais `idempotency-cleanup`. Periódicos sem duplicar (0008), retentativa com espera crescente, webhooks assinados com HMAC e segredo cifrado. Por HTTP: sem segredo, 401; com segredo, os quatro jobs rodaram

### 🔒 GATE M1 (aprovação do Fábio)
- [ ] Demonstração: agente de teste cria e conclui tarefa por MCP e por REST; `activity_log` e rollup conferidos no banco; RLS de cliente testada

---

## M2 — Publicação inicial na VPS (atrás de login)

> Autorizações necessárias do Fábio antes de qualquer item de infra: registro DNS, criação de `/opt/hub-gestao`, rota Traefik, segredos do GitHub Actions.

### Pipeline
- [ ] `deploy/vps/Dockerfile` (multi-stage, Node 22, `standalone`, usuário sem root, rootfs somente leitura)
- [ ] `deploy/vps/docker-compose.yml` (`hub-app`, rede `hub_proxy`, limites 1,5 CPU / 2 GB, `env_file` apontando para `/opt/hub-gestao/shared/.env.production`)
- [ ] `deploy/vps/hub-deploy.sh` e `hub-deploy-ssh.sh` (modelo RELGOV: comando restrito `load <sha>`, validação do SHA, troca de container, healthcheck, rollback)
- [ ] `deploy/vps/hub-traefik.yaml` (rota `Host(hub.harmonydigital.com.br)`, Let's Encrypt, cabeçalhos de segurança)
- [ ] `deploy/vps/hub-cron.service` e `hub-cron.timer` (a cada 5 min → `/api/internal/cron/tick`)
- [ ] `.github/workflows/deploy-vps.yml` (ambiente `hub-production`, `needs: ci`, imagem sem segredos, SSH restrito)
- [ ] `deploy/vps/README.md` documentando o fluxo, segredos (nomes, nunca valores) e operação

### Provisionamento na VPS (com autorização, passo a passo registrado)
- [ ] Fábio cria/autoriza o registro DNS `hub` → CNAME `srv1821299.hstgr.cloud` (D1)
- [ ] Criar `/opt/hub-gestao/{config,shared,releases}` (root), `.env.production` `0600` preenchido pelo Fábio
- [ ] Usuário de deploy com chave SSH restrita ao comando `load`
- [ ] (acrescentada em 2026-10-09) Papel de banco próprio para o servidor do Hub: login dedicado, sem passe livre na RLS e com acesso só ao schema `proj_hub_gestao`. É uma mudança global no Supabase compartilhado e só acontece com confirmação específica do Fábio. Sem esse papel, o servidor entraria como administrador e a RLS deixaria de valer como segunda linha de defesa. O código já recusa abrir o banco de produção com papel que passe por cima da RLS (conferência de partida em `src/lib/db/guard.ts`)
- [ ] Rota Traefik instalada em `/etc/easypanel/traefik/config/hub.yaml`; certificado emitido
- [ ] Segredos no GitHub (`HUB_VPS_HOST`, `HUB_VPS_USER`, `HUB_VPS_SSH_KEY`, `HUB_VPS_KNOWN_HOSTS`, `HUB_NEXT_PUBLIC_SUPABASE_ANON_KEY`) e variável `HUB_DEPLOY_URL` — provisionados pelo Fábio
- [ ] Primeiro deploy verde; `curl https://hub.harmonydigital.com.br/api/health` com o SHA da `main`
- [ ] Medição read-only de recursos da VPS antes e depois (CPU, RAM, disco) registrada aqui
- [ ] **(D8, antecipado)** Backup diário do schema `proj_hub_gestao` (`pg_dump -n` por timer systemd, retenção de 14 dias, cópia fora da VPS com destino a definir com o Fábio) ativo antes de entrar qualquer dado real; primeiro arquivo conferido

### Autenticação mínima
- [ ] Login por e-mail/senha e magic link (Supabase Auth); primeiro usuário = `owner`; tela de login com identidade Harmony
- [ ] Toda rota de UI exige sessão; API e MCP exigem chave; `noindex` global até o portal

### 🔒 GATE M2 (aprovação do Fábio)
- [ ] Fábio faz login em `https://hub.harmonydigital.com.br`; Claude Code conclui tarefa por MCP contra produção; health com SHA

---

## M3 — Interface interna essencial

### Shell
- [ ] Barra lateral recolhível (Hoje · Minhas tarefas · Aprovações · Clientes › Projetos · Departamentos · Agentes · Relatórios · Configurações), barra superior com `⌘K` (`cmdk`), criação rápida, breadcrumb, abas de visão
- [ ] Tema claro/escuro com tokens; `prefers-reduced-motion`; foco visível; navegação por teclado

### Hoje (cockpit)
- [ ] Aprovações pendentes (Aprovar / Ajustar / Recusar), bloqueios que dependem de mim, minhas tarefas, riscos, resumo de agentes (24h); para `owner`, consolidado de todos os projetos

### Clientes e projetos
- [ ] CRUD de clientes; CRUD de projetos (código, fase, status, departamentos, responsável, agente gestor, repo, `plan_path`, `require_evidence`, `client_can_confirm_receipt`)
- [ ] Painel do projeto em três blocos: Macro (marcos, saúde, próximos aceites), Tático (frentes por departamento com progresso), Operacional (fila do dia, bloqueios, atividade dos agentes)
- [ ] Marcos: criar/editar (humanos), critérios de aceite, aceite com registro em `approvals`
- [ ] Frentes: criar/editar, departamento, visibilidade, responsável

### Tarefas e visões
- [ ] **Lista** com grupos (status, frente, responsável, prioridade), ordenação, colunas configuráveis, edição em linha de status/prioridade/responsável/data
- [ ] **Quadro** Kanban com `@dnd-kit` (arrastar entre status e reordenar), swimlanes por frente/responsável, cartões leves
- [ ] **Painel lateral de tarefa**: tudo da tarefa; comentários (TipTap, Markdown, menções); checklist; anexos (Storage privado, URL assinada); dependências; evidência de conclusão; histórico
- [ ] Status personalizáveis por projeto sobre categorias fixas; conjunto padrão Harmony
- [ ] Realtime (Supabase) para atualizar lista/quadro quando um agente escreve
- [ ] Filtros combináveis e visões salvas por usuário

### Aprovações
- [ ] Tela de aprovações com filtro por tipo e projeto; decisão com orientação; efeito automático (publicar, promover visibilidade, aceitar marco)

### Agentes (Console "Sala de Controle")
- [ ] Cadastro de agentes (tipo, departamento, missão, orçamento, dono); criação de chave com exibição única; escopos e projetos; expiração; revogação; pausa (kill switch)
- [ ] Feed em tempo real de `activity_log` filtrado por agente/projeto; erros de autorização; custo de IA no mês

### Notificações
- [ ] Inbox no app com menções, atribuições, aprovações, bloqueios; preferências por tipo

### Qualidade
- [ ] Playwright: criar tarefa → mover no quadro → concluir com evidência → aprovar algo no Hoje
- [ ] Revisão de acessibilidade (axe) e de identidade (sem emojis, fontes e cores corretas)

### 🔒 GATE M3 (aprovação do Fábio)
- [ ] Fábio opera um projeto real pela interface por uma semana (dogfooding) e aprova o essencial

---

## M4 — `plan.md`, CLI, GitHub e importação do próprio Hub

### Sincronização
- [ ] `src/modules/sync`: parser byte-neutro do `PLAN.md` (headings `##` → marcos, `###` → frentes, `- [ ]` → tarefas, aninhado → subtarefas, linhas `🔒 GATE` → aprovações), geração com códigos `(HUB-n)`
- [ ] Regras: Hub vence; `[x]` em GATE ignorado e alertado; itens removidos do arquivo viram `archived`; divergências em `plan_sync_runs` e comentário
- [ ] Endpoints `GET/POST /api/v1/sync/plan` e tool `hub_sync_plan`; testes com os `PLAN.md` reais do RELGOV e do IA Posicionamento como fixtures (sem dados sensíveis)

### CLI `hub`
- [ ] `packages/cli`: `hub init` (`.hub.json`), `hub plan pull`, `hub plan push`, `hub task start|done|new`, `hub today`; `HUB_API_KEY` por ambiente; mensagens em PT-BR
- [ ] Publicação interna (tarball no repo ou GitHub Packages); instruções em `docs/cli.md`
- [ ] GitHub Action reutilizável `hub-sync.yml` (`push` em `main` → `hub plan push`)

### GitHub Sync (GH-16)
- [ ] Webhook `/api/internal/webhooks/github` com segredo; commits/PRs com `HUB-n` viram comentário com link e SHA; `fecha HUB-n` vira proposta de conclusão
- [ ] Documentação de instalação do webhook por repositório

### Importação (D10)
- [ ] Importar este `PLAN.md` como projeto `HUB` (dogfooding: o Hub se gerencia)
- [ ] ~~Importar dois projetos ativos escolhidos pelo Fábio; conferir árvore, códigos e GATEs; `hub plan pull` nos repositórios correspondentes~~ — **cancelado** por D10 (2026-10-09): todos os projetos serão importados por agente no M5
- [ ] Primeira sessão de Claude Code em um repositório importado concluindo tarefa via CLI e aparecendo no quadro — no M4, o próprio repositório `hub-gestao` (D10)

### 🔒 GATE M4 (aprovação do Fábio)
- [ ] Projeto `HUB` e dois projetos reais sincronizados; sessão de código fecha tarefa e o quadro reflete — D10: no M4 basta o projeto `HUB`; os projetos reais entram na importação geral do M5

---

## M5 — Agentes de gestão (Kratos no Hermes) + Concierge e Planejador + importação de todos os projetos

### Hermes
- [ ] Confirmar na instalação da VPS como registrar servidores MCP e crons no Hermes (versão, formato de configuração) e documentar em `agents/hermes/README.md` (sem segredos)
- [ ] ~~Perfil dedicado "Gestor de Projetos" (D6) com `SOUL.md`, `AGENTS.md` e skills versionados em `agents/hermes/gestor-de-projetos/`~~ — **cancelado** por D6 (2026-10-09), ver item seguinte
- [ ] **(D6)** Papéis de gestão como skills do Kratos: `gestor-de-projetos`, `coordenador-tatico`, `relator-de-status`, `guardiao-da-qualidade` e `vigia-de-prazos`, versionadas no segundo cérebro (`workspace-backup/skills/gestao-hub/`) com cópia de referência em `agents/hermes/`; nenhuma mudança no `SOUL.md` do Kratos sem aprovação do Fábio
- [ ] ~~Chaves de agente criadas pelo Fábio para GP-01, CT-02, RL-03, QA-04, VP-05 e KR-00 com os escopos de `AGENTES.md` §4~~ — **cancelado** por D6 (2026-10-09), ver item seguinte
- [ ] **(D6)** Uma chave de agente para o Kratos, criada pelo Fábio, com a união dos escopos de gestão e `projects:import` (`AGENTES.md` §4); toda escrita informa o `papel` usado (gestor, coordenador, relator, guardiao, vigia, importador), gravado em `activity_log.acting_role`
- [ ] Crons: digest matinal (8h dias úteis), status interno (segunda), verificação de conclusões (noturno), resumo executivo (fim do dia)
- [ ] Webhook do Hub → Hermes → Telegram do Fábio para `approval.requested`, `project.health_changed`, `agent.budget_exceeded`
- [ ] Kratos com chave de leitura; teste "como está o projeto X?" — D6: o Kratos usa a chave de gestão do item acima; o teste continua valendo

### Regras determinísticas no Hub (base do VP-05 e QA-04)
- [ ] Job `health-rollup` aplicando PRD §5.7 e emitindo `project.health_changed`
- [ ] Job `evidence-check`: conclusões sem evidência em projetos `require_evidence` são reabertas e notificadas
- [ ] Job `approval-aging`: aprovações > 3 dias úteis sinalizadas no Hoje

### Agentes internos (IA multi-provedor, D5)
- [ ] ~~`src/lib/llm`: adaptador multi-provider (Claude padrão, OpenAI alternativo), prompt caching, orçamento por agente, fail-closed~~ — **substituído** por D5 (2026-10-09), ver itens seguintes
- [ ] **(D5)** `src/lib/llm` com AI SDK v7 e três provedores: Anthropic (Claude), OpenAI e xAI (Grok); provedor, modelo e credencial lidos da configuração do agente a cada chamada; cache de prompt quando o provedor suportar; orçamento por agente; fail-closed
- [ ] **(D5)** Tabela `llm_credentials` com cifragem AES-256-GCM e `HUB_ENCRYPTION_KEY`; cadastro e troca de chave só pelo `owner`; exibição só dos 4 últimos caracteres; chave nunca no navegador, em logs ou em prompts
- [ ] **(D5)** Tela Agentes → "Modelo de IA": provedor, modelo (lista buscada na API do provedor, com campo livre), credencial, teto mensal e botão "Testar conexão"; troca registrada em `activity_log` e válida já na chamada seguinte, sem deploy
- [ ] **(D5)** Teste automatizado: o mesmo agente responde com cada um dos três provedores (mocks em CI e uma chamada real por provedor na homologação) e cai no modo sem IA quando a chave falha
- [ ] **CO-10 Concierge**: barra `⌘K` com linguagem natural e ditado (Web Speech API); interpretação → prévia estruturada → confirmação → execução em nome do humano; testes de intenções principais
- [ ] **PL-11 Planejador**: de PRD/brief/template para proposta de marcos, frentes, tarefas e textos para cliente; aprovação cria a estrutura e gera `PLAN.md` inicial
- [ ] Prompts versionados em `app/src/modules/agents/prompts/` com changelog

### Importação de todos os projetos (D10)
- [ ] Ferramentas `hub_create_client`, `hub_create_project` e `hub_import_plan` (escopo `projects:import`); o projeto importado nasce `in_review` ("Em revisão") e abre aprovação `import_review`, que o Fábio decide em lote no Hoje
- [ ] Skill `importar-projetos-no-hub` para o agente importador: onde ler cada projeto, como mapear cliente, projeto, departamentos, marcos, frentes e GATEs, e o que nunca importar (segredos, dados pessoais, respostas manuscritas do manual de posicionamento)
- [ ] Sessão de orientação: o Fábio explica ao agente como quer os projetos estruturados; a orientação vira parte da skill
- [ ] Confirmar o acesso de leitura do Kratos aos repositórios da Harmony no GitHub, sem permissão de escrita
- [ ] Importação de todos os projetos ativos: o Kratos importa os que estão no GitHub; os que só existem em pasta no Mac são importados por uma sessão do Claude Code com a mesma ferramenta
- [ ] Revisão do Fábio no Hoje; projetos aprovados passam a sincronizar com o `plan.md` de cada repositório

### 🔒 GATE M5 (aprovação do Fábio)
- [ ] Uma semana de digests reais no Telegram; um replanejamento proposto pelo GP-01 e decidido no Hoje; uma tarefa criada por voz pelo Concierge; todos os projetos ativos importados e aprovados pelo Fábio (D10)

---

## M6 — Portal do cliente e relatórios

### Portal
- [ ] Rotas `/portal/<cliente>` com magic link para `client_contacts`; sessão curta; `noindex`; sem rastreadores
- [ ] **(D9)** Acesso só por convite: o contato cadastrado nasce sem acesso; o botão "Liberar acesso", exclusivo do `owner`, envia o convite por e-mail ou gera um link de uso único para o Fábio enviar por onde quiser; revogar a qualquer momento; sem cadastro aberto
- [ ] Páginas: projetos do cliente; projeto (objetivo, fase, marcos com data e status, frentes `client` com progresso, relatórios aprovados, canal de comentários, arquivos entregues, confirmar recebimento de marco se habilitado — D9)
- [ ] DTOs do portal sem campos internos; RLS de papel cliente; **teste automatizado de vazamento** (SQL + Playwright) em CI
- [ ] Identidade: logo Harmony, cor de destaque do cliente em detalhes, mais ar, segunda pessoa

### Relatórios e redação
- [ ] **RL-03 (cliente)**: rascunho `audience = client` semanal → **RC-12 Redator do Cliente** (tom Harmony + verificação de termos internos, códigos `HUB-n`, agentes, SHAs) → `approval` → publicação no portal → e-mail via Resend se habilitado
- [ ] Promoção de frente a `client` com proposta de `title_client`/`description_client` pelo RC-12 e aprovação
- [ ] Versões de relatório guardadas; histórico no portal

### Onboarding (OB-13)
- [ ] Fluxo: cliente criado → contatos → textos iniciais → convite (aprovação `external_message`) → consentimento LGPD no primeiro acesso — D9: o convite só sai quando o Fábio clicar em "Liberar acesso"; o OB-13 prepara, nunca envia

### 🔒 GATE M6 (aprovação do Fábio)
- [ ] Cliente piloto (escolhido pelo Fábio) acessa o portal, recebe o primeiro status aprovado e comenta; teste de vazamento verde

---

## M7 — Departamentos, visões avançadas, templates e tempo

- [ ] Visão por departamento: quadro cruzando projetos, carga por agente/pessoa (`v_department_load`), bloqueios, tarefas sem responsável
- [ ] **Linha do tempo** (marcos e frentes em barras, dependências), **Calendário** (entregas), **Tabela** (edição em linha, grupos, estilo Monday), **Painel** (widgets: saúde, progresso por marco, carga por departamento, atividade de agentes)
- [ ] Dependências entre frentes com alerta; dependências entre tarefas no quadro
- [ ] Templates de projeto: estrutura em `project_templates`; os seis iniciais da Harmony; criação a partir de template; exportar projeto como template
- [ ] Registro de tempo (`time_entries`) por tarefa; **TO-15** consolidando tempo e custo de IA por projeto
- [ ] Campos personalizados (texto, número, seleção, data, URL) por projeto
- [ ] **EX-09 Dados** e **N8-17 n8n Bridge** com chaves de escopo mínimo; um fluxo n8n real criando tarefa
- [ ] Exportação de atividade por período (CSV/JSON)

### 🔒 GATE M7 (aprovação do Fábio)
- [ ] Revisão mensal de portfólio feita na visão por departamento; um projeto criado de template

---

## M8 — Operação, segurança, backups e LGPD

- [ ] **Backups (D8)**: `pg_dump -n proj_hub_gestao` diário por timer → Storage privado + cópia fora da VPS; snapshot semanal da VPS; **teste de restauração** em banco temporário documentado
- [ ] Observabilidade: `/api/health` completo (banco, fila, versão), logs `pino` sem PII, alertas via webhook → Telegram (deploy falhou, fila parada, orçamento estourado, autorização recorrente)
- [ ] Hardening: CSP, HSTS, cookies, CORS, rate limit revisado, cabeçalhos do portal; revisão de RLS com `get_advisors`; role de banco restrita ao schema (pendência herdada do RELGOV) avaliada
- [ ] **AC-14 Auditor**: relatório semanal de chaves, membros, aprovações antigas, custos; rotação de chaves documentada
- [ ] LGPD: consentimento, exportação e exclusão por cliente; retenção de logs; `docs/privacidade.md`
- [ ] Runbook `docs/operacao.md`: deploy, rollback, restauração, pausar agente, rotacionar segredo, incidente de vazamento
- [ ] Teste de carga leve (lista/quadro p95 < 400 ms com 5 mil tarefas)

### 🔒 GATE M8 (aprovação do Fábio)
- [ ] Restauração testada e registrada; auditoria de acesso lida e ações decididas

---

## M9 — Produto replicável

> ⏸ **Adiado por decisão do Fábio (D7, 2026-10-09):** o Hub é de uso interno da Harmony. Este milestone só começa depois de validado e com nova decisão dele. As tarefas ficam como referência.

- [ ] Multi-workspace real: isolamento por `workspace_id` em tudo; branding e configurações por workspace; testes de RLS entre workspaces
- [ ] `hub init-workspace`: cria workspace, departamentos, status, templates, agentes padrão e primeiro `owner`
- [ ] Pacote de implantação: checklist DNS/Traefik/segredos, migrações, carga de templates, criação dos agentes no Hermes (do cliente ou gerenciado pela Harmony)
- [ ] Opção de instância dedicada (export/import do schema para Supabase próprio do cliente)
- [ ] White-label: nenhum texto "Harmony" fixo no código; textos padrão do portal configuráveis
- [ ] Documentação de produto (`docs/produto/`): o que é, como implantar, como operar, limites
- [ ] Decisão comercial do Fábio (D7 e modelo): licença + implantação, assinatura com agentes gerenciados, coprodução
- [ ] Segundo workspace de teste criado do zero em menos de um dia, com um projeto, um agente e um portal funcionando

### 🔒 GATE M9 (aprovação do Fábio)
- [ ] Oferta definida; segundo workspace funcionando; pacote de implantação validado

---

## Riscos acompanhados

| Risco | Sinal | Ação prevista |
|---|---|---|
| Escopo inchar antes do P0 | Tarefas de M7 sendo puxadas para M3 | Recusar; anotar como pedido futuro |
| Aprovações acumulando no Hoje | > 10 pendentes por mais de 3 dias | GP-01 agrupa; padrões aprovados viram regra |
| `plan.md` e Hub divergindo com frequência | `plan_sync_runs.conflicts` crescendo | Revisar parser; reforçar `pull` no início da sessão |
| VPS saturando | RAM disponível < 2 GB após deploy | Reduzir limites, avaliar mover n8n/Evolution ou segundo VPS |
| Hermes sem suporte estável a MCP | Erros de conexão nos crons | Skill REST de fallback |

## Registro de Execução

| Data | IA / Sessão | Entregue | Pendências deixadas |
|---|---|---|---|
| 2026-10-08 | Claude (Fable 5.1) · Claude Code | Levantamento read-only da stack real (VPS KVM4 `1821299`: 4 vCPU, 16 GB, 163 GB livres; Supabase compartilhado `/opt/supabase-harmony` + dedicado RELGOV; Traefik/EasyPanel; Hermes em container; n8n em fila; pipeline GitHub→VPS do RELGOV). Pasta `Projetos de IA/Sistema de Gestão da Harmony Digital/` com `CLAUDE.md`, `AGENTS.md`, `PRD.md`, `AGENTES.md`, `PLAN.md`. Nenhuma alteração em infra, banco, DNS ou GitHub. | Fábio responder D1–D11; GATE M0. Observação: a leitura detalhada de `harmony_admin.projects`, do Compose do Hermes e das rotas Traefik foi bloqueada pela política de leitura de produção da sessão; confirmar no M0 com o MCP `harmony-supabase-readonly` e por SSH autorizado. |
| 2026-10-09 | Claude (Opus 5.5) · Claude Code | Fábio respondeu D1–D11. Documentos ajustados: IA multi-provedor por agente, com chaves cifradas e troca pela tela Agentes (D5); papéis de gestão como skills do Kratos, com chave única e campo `papel` (D6); uso interno e M9 adiado (D7); backup diário antecipado para o M2 (D8); portal só por convite liberado pelo Fábio (D9); importação de todos os projetos por agente no M5, com as ferramentas `hub_create_client`, `hub_create_project` e `hub_import_plan` e revisão em lote (D10). Corrigida a versão do framework nos documentos: Next.js 16, não 15. | 🔒 GATE M0 (aceite do PRD) segue com o Fábio. Próximo passo técnico: criar o repositório e registrar o schema. O MCP `harmony-supabase` estava sem conexão nesta sessão (ECONNREFUSED no endereço local); religar antes do registro do schema. |
| 2026-10-09 | Claude (Opus 5.5) · Claude Code | Protótipo navegável publicado como artifact privado do tipo Design, com 10 telas e dados de exemplo fictícios: Hoje, Projetos, Hoje no celular, Projeto em três camadas, Quadro e tarefa, Aprovações, Sala de Controle, Departamentos, Portal do cliente e Concierge por voz. Link: https://claude.ai/artifact/F7ss9Ajt9aD6PuAC9D3p2d. Serve de referência visual e de comportamento para o M3 e o M6. | Fábio revisar as telas e apontar ajustes antes da construção. Os cliques não foram testados um a um nesta sessão. |
| 2026-10-09 | Claude (Opus 5.5) · Claude Code | Construção iniciada após o aceite do PRD. Repositório privado Harmony-Digital/hub-gestao criado; app Next.js 16.4 com identidade Harmony, rota de saúde, página provisória, Vitest e saída standalone; CI verde no primeiro push (run 37958296836). Dependências de produção sem vulnerabilidades; os 9 alertas do npm audit são de ferramentas de desenvolvimento (cadeia braces/micromatch no lint e no instalador do shadcn). O next dev do painel de preview travava com EMFILE; resolvido elevando o limite de arquivos na configuração local de preview. | Registrar o schema `proj_hub_gestao` (preflight + `harmony_admin.create_project`) depois de reconectar o MCP `harmony-supabase`; decidir a exposição do schema no PostgREST; proteção de branch indisponível no plano Free; GATE M0 final com o Fábio. |
| 2026-10-09 | Claude (Opus 5.5) · Claude Code | Pedido do Fábio: “teste novamente”. Túnel do conector conferido e servidor MCP do Supabase respondendo (0.7.0). Conferência só de leitura feita direto no servidor MCP, porque esta sessão não consegue religar o conector: catálogo com 4 projetos, sem `hub_gestao`, função de registro revisada. Slug corrigido nos documentos para `hub_gestao`. Decidido não expor o schema no PostgREST no M1. | A criação do schema foi barrada pela proteção automática do Claude Code; aguarda o Fábio reconectar o `harmony-supabase` ou liberar a permissão. |
| 2026-10-09 | Claude (Opus 5.5) · Claude Code | Fábio reconectou o MCP `harmony-supabase`. Conferência refeita (4 projetos, sem o Hub) e schema `proj_hub_gestao` criado pela função oficial, com acessos conferidos e sem avisos de segurança no schema. Todas as tarefas do M0 estão concluídas, exceto a proteção de branch, indisponível no plano Free. | GATE M0 com o Fábio. Depois do ok, começar o M1 pelas migrations `hub_gestao_0001_foundation` em diante. |
| 2026-10-09 | Claude (Opus 5.5) · Claude Code | GATE M0 aprovado pelo Fábio (“Pode continuar.”) e M1 construído. Banco: migrations 0001 a 0008 aplicadas no Supabase compartilhado (39 tabelas, todas com RLS), alertas de segurança zerados no schema do Hub, seed da Harmony aplicado. O próprio banco recusa decisão e aceite de marco por agente. App: autorização central, auditoria, idempotência, chaves de agente, API REST v1 (34 operações, OpenAPI 3.1 versionado em `docs/api`), servidor MCP com 22 ferramentas (lista versionada em `docs/mcp`), fila de jobs com relógio protegido, guia `docs/agentes-conexao.md`. 127 testes verdes; build sem avisos e sem código de desenvolvimento na saída de produção. Demonstração local: HUB-1 pela REST, HUB-2 pelo cliente MCP do SDK e HUB-3 por uma sessão do Claude Code, todas concluídas com evidência e registradas. Trabalho na branch `feat/m1-nucleo-agentes`. | 🔒 GATE M1 com o Fábio. O teto de IA fica aberto até o adaptador de IA do M5. Para o M2: papel de banco próprio do Hub, que exige confirmação específica do Fábio, e os passos de infraestrutura que dependem de autorização (DNS, pasta na VPS, rota Traefik, segredos). |
| 2026-10-09 | Claude (Opus 5.5) · Claude Code | Revisão de segurança independente do M1 (outro agente, só leitura): nenhum achado crítico ou alto; sete achados médios e baixos confirmados e corrigidos. Títulos com quebra de linha podiam forjar linhas de GATE no plan.md exportado (agora recusados pela API e pelo banco, e o exportador junta tudo numa linha). Lotes JSON-RPC no MCP passavam por cima do limite de pedidos e do limite de corpo (agora recusados). Repetição idempotente com outra chave do mesmo agente devolvia dados fora do escopo dessa chave (agora 409). Reuso concorrente de chave vencida, mais de uma tarefa em andamento e pedidos ou versões duplicados sob concorrência (trava por agente e índices únicos). Chave `workspace:*` restrita a projetos alcançava todos (criação recusa; lista guardada vale). Duas leituras exigiam escopo a mais. MCP com chave de idempotência opcional e sem registro de último uso (agora obrigatória e registrado). Também: migration 0009 com travas de escrita para agentes e conferência de partida que recusa papel de banco que ignore a RLS. 151 testes verdes; build sem avisos. | GATE M1 com o Fábio. Mantido de propósito: agente recebe 403 explicado (e não 404) para projeto fora da chave, porque o aviso ajuda o agente a pedir acesso. |
