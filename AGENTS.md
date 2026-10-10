# AGENTS.md — Guia canônico para agentes de IA neste projeto

> Este arquivo é a **fonte canônica de instruções** para qualquer IA (Claude Code, Codex, Hermes, Gemini ou outra) que for **construir, verificar, operar ou usar** o Hub de Gestão da Harmony Digital. O `CLAUDE.md` aponta para cá. Leia este arquivo inteiro antes de qualquer trabalho. Ele tem duas partes: **A) como trabalhar neste repositório** (quem constrói o Hub) e **B) Protocolo do Agente Operador** (quem usa o Hub para gerir e executar projetos).

---

## 1. O que é este projeto

O **Hub de Gestão** é o sistema de gestão da Harmony Digital para projetos, departamentos e atividades. Ele existe porque:

1. **Todo projeto da Harmony nasce com um `plan.md` em formato checklist** e os agentes (Claude Code, Codex) dão baixa nas tarefas. Esse arquivo é operacional e técnico; não serve para o Fábio enxergar o todo nem para o cliente acompanhar.
2. **O Fábio não é planejador nem gestor de ofício.** O Hub e seus agentes assumem a gestão tática e operacional e devolvem a ele **decisões**, não tarefas de planejamento.
3. **Cada cliente terá um portal** para acompanhar a construção do seu projeto na camada estratégica (e, quando fizer sentido, tática), **sem ver a camada operacional**.
4. **Os agentes são os principais usuários.** Claude Code, Codex e, sobretudo, um **agente autônomo de gestão de projetos no Hermes** (que já roda na VPS da Harmony) vão operar o sistema por API e MCP. O Fábio raramente mexerá direto. Na fase 1, esse agente de gestão é o **Kratos** (D6).
5. **É um modelo, por enquanto de uso interno.** A Harmony é o primeiro e, por decisão do Fábio (D7), o único workspace até o sistema ser validado. A arquitetura continua preparada para replicação, sem esforço comercial agora.

Referências visuais declaradas pelo Fábio: **ClickUp** (principal: hierarquia, visões, densidade, painel lateral de tarefa), **Monday.com** (status coloridos, tabelas) e **Trello** (fluidez do quadro Kanban). Identidade visual é a da Harmony ("Sala de Controle"), nunca a dessas ferramentas.

### Modelo de Gestão em Três Camadas (resumo; detalhes no `PRD.md` §5)

| Camada | Objeto no Hub | Pergunta que responde | Dono | Cliente vê? |
|---|---|---|---|---|
| **Estratégica (macro)** | Objetivos e **Marcos** (entregas com data e aceite) | O que o cliente recebe e quando? | Fábio + Gestor de Projetos (agente) | **Sim** |
| **Tática** | **Frentes** (pacotes de trabalho por departamento, ligados a um marco) | Como vamos chegar lá e quem cuida de cada parte? | Coordenador Tático (agente) + líderes | **Opcional**, item a item (`visibility = client`) |
| **Operacional (micro)** | **Tarefas**, subtarefas, checklists, comentários internos, logs de agentes | O que está sendo feito agora? | Agentes executores e equipe | **Nunca** |

Mapeamento com o `plan.md` de cada projeto: `## Marco` = Marco · `### Seção` = Frente · `- [ ] item (HUB-123)` = Tarefa · item aninhado = Subtarefa · linha `🔒 GATE` = pedido de aceite do marco (aprovação humana). Regras completas da leitura (título, nota, evidência, continuações, seção ignorada com `<!-- hub: ignorar -->`) em `docs/plan-md.md`.

---

## 2. Documentos e ordem de leitura

1. `AGENTS.md` (este) → 2. `PRD.md` → 3. `AGENTES.md` → 4. `PLAN.md` (estado vivo; executar a próxima tarefa pendente do milestone atual) → 5. `app/AGENTS.md` e docs locais do framework, quando existirem.

`PLAN.md` é o único lugar onde o progresso é registrado. Nunca criar arquivos paralelos de status.

---

## 3. Princípios inegociáveis (Harmony)

1. **A IA executa. O humano decide.** Ações externas (mensagem a cliente, aceite de marco, mudança de escopo, publicação, envio de e-mail, alteração de DNS/infra) exigem `approval` humana registrada.
2. **Fail-closed.** Em dúvida sobre permissão, escopo, destino de banco ou identidade: parar, registrar e perguntar. Nunca "tentar e ver".
3. **Derivar, nunca inventar.** Status, prazos, percentuais e riscos vêm de dados do Hub. Textos para cliente citam marcos e entregas reais.
4. **Evidência antes do `[x]`.** Commit SHA, URL, arquivo, saída de teste ou consulta ao banco. Trabalho parcial fica `[ ]` com nota `⏳`.
5. **Controle dos ativos nas contas da Harmony.** GitHub `Harmony-Digital`, VPS própria, Supabase próprio, DNS na Hostinger. Nenhuma dependência de plataforma fechada.
6. **Segredos fora de chat, git, logs e comentários.** Sempre.
7. **Uma sessão de IA por vez no repositório.** Conflitos paralelos já custaram retrabalho em outros projetos da Harmony.
8. **Português do Brasil** em UI, documentos, commits e mensagens. Inglês nos identificadores de código, tabelas e colunas.
9. **Sem emojis na interface** e sem "cara de sistema feito por IA". Ícones de linha, tipografia, espaço.

---

## Parte A — Como trabalhar neste repositório

## 4. Fluxo de uma sessão de trabalho

**Início**
1. Ler §2. Abrir `PLAN.md`: identificar o milestone atual e a próxima tarefa `[ ]` sem dependência pendente.
2. `git status` limpo e branch certa (`main` só para merges; trabalho em `feat/…`, `fix/…`, `docs/…`).
3. Preflight de identidade (§6). Se qualquer item falhar, não escrever.
4. Declarar no chat, em uma linha, o que será feito.

**Durante**
5. Entregas pequenas e verificáveis. Cada tarefa do `PLAN.md` deve caber em uma sessão.
6. Testar de verdade: navegador (`npm run dev`, com o login de teste e o projeto de exemplo, §6.4, no computador e no celular), banco (consulta read-only), API (`curl` ou teste), MCP (cliente de teste). Nada é verificado "por leitura de código".
7. Descobriu trabalho novo? Adicionar tarefa `[ ]` no milestone certo, nunca executar escopo futuro sem pedido.

**Fim**
8. `npm run check` verde.
9. Atualizar `PLAN.md`: marcar `[x]` só o verificado, com evidência curta; adicionar linha no **Registro de Execução** (data, IA, entregue, pendências).
10. Commit com mensagem descritiva em PT-BR, `git add` com caminhos explícitos. Push só quando o `PLAN.md` ou o Fábio autorizar.
11. A `main` só recebe PR com squash merge, depois do CI "Qualidade" verde nos dois jobs (app e imagem de produção). **Todo merge na `main` é publicado em produção sozinho** (§8), então só entra trabalho verificado. O painel de PR do app Claude não acompanha este repositório (é subpasta da pasta da sessão): acompanhar o CI com `gh run watch` e, depois do merge, conferir a publicação e o `/api/health` com o SHA.
12. Se algo ficou quebrado ou pela metade, dizer isso explicitamente na última mensagem.

## 5. Stack e convenções de código

### 5.1 Estrutura do repositório `Harmony-Digital/hub-gestao` (atual, 2026-10-10)

```
hub-gestao/
├── AGENTS.md · CLAUDE.md · PRD.md · AGENTES.md · PLAN.md · README.md
├── app/                               # Next.js 16.4: telas, API REST v1 e MCP
│   ├── src/app/(interno)/             # telas da equipe: Hoje (/), projetos, agentes, conta
│   │   └── projetos/[code]/           # Visão geral (page.tsx), lista/, quadro/, _tasks/ (cabeçalho com
│   │                                  #   abas, painel da tarefa, formulários, ações, Kanban, filtro) e
│   │                                  #   _plan/ (janelas de marco e de frente)
│   ├── src/app/login/ · auth/         # login (Supabase Auth) e retorno do link de acesso
│   ├── src/app/api/v1/…               # REST para agentes e integrações (OpenAPI 3.1)
│   ├── src/app/api/health/ · api/internal/cron/   # saúde e relógio dos jobs
│   ├── src/app/mcp/route.ts           # servidor MCP Streamable HTTP
│   ├── src/proxy.ts                   # porta das telas (o "middleware" do Next 16)
│   ├── src/modules/                   # casos de uso por domínio: projects, tasks, milestones, workstreams,
│   │                                  #   archive, comments, approvals, agents (com os prompts versionados
│   │                                  #   em agents/prompts), llm (chaves e modelo de IA), concierge (CO-10),
│   │                                  #   planner (PL-11),
│   │                                  #   sync (plan.md), github, reports, time, today, search, health,
│   │                                  #   jobs, mcp, shell
│   ├── src/lib/                       # authorize, audit, idempotency, auth, db (pg e PGlite), errors,
│   │                                  #   format, labels, links, ui-context e llm (adaptador de IA)
│   ├── src/components/                # shell (barra lateral, cabeçalho, selos), forms e form-dialog
│   │                                  #   (peças de formulário e janela) e ui (shadcn)
│   ├── src/test/hub.ts                # ambiente de teste: PGlite com migrations, seed, projeto VIT,
│   │                                  #   agentes e chaves criados pelo caminho real
│   ├── e2e/                           # testes de ponta a ponta (Playwright) e playwright.config.ts
│   └── scripts/cron-tick.mjs          # relógio dos jobs, chamado pelo timer da VPS
├── supabase/migrations/ · seeds/      # hub_gestao_0001 a 0014 e o seed da Harmony
├── deploy/vps/                        # Dockerfile, compose, rota do Traefik, timers, publicação,
│                                      #   backup e provisionamento (README com o passo a passo)
├── scripts/                           # conectar o Claude Code à produção e teste MCP de produção
├── packages/cli/                      # CLI hub (um arquivo, sem dependências) e os testes dela
├── agents/skills/                     # skills versionadas dos agentes que operam o Hub
│                                      #   (importar-projetos-no-hub: o agente importador, D10)
├── docs/                              # credenciais, conexão dos agentes, contratos da API e do MCP,
│                                      #   formato do plan.md (plan-md.md) e a CLI (cli.md)
└── .github/workflows/                 # ci.yml ("Qualidade") e deploy-vps.yml ("Publicação na VPS")
```

Ainda não existem: portal do cliente (`src/app/portal/`, M6) e as skills de gestão do Kratos versionadas (`agents/hermes/`, M5); a skill do importador já está em `agents/skills/`. Os testes de unidade e integração ficam ao lado do código (`*.test.ts`), não numa pasta `tests/`; os de ponta a ponta ficam em `app/e2e/`.

### 5.2 Convenções

- **TypeScript estrito**, sem `any` implícito. `zod` em todas as fronteiras (API, MCP, formulários, env).
- **Server-only** para segredos e acesso ao banco (`import 'server-only'`). O navegador não fala com o banco: telas (server components) e ações de formulário (server actions) passam pelos casos de uso de `src/modules`, com `authorize()`, auditoria e `source = ui`. A chave pública do Supabase só serve ao login (Supabase Auth). O schema não é exposto no PostgREST.
- **IA multi-provedor (D5)**: nenhum código chama SDK de provedor diretamente. Tudo passa por `src/lib/llm` (AI SDK v7 com Anthropic, OpenAI e xAI), que lê provedor, modelo e credencial da configuração do agente a cada chamada. Trocar de provedor é configuração, nunca deploy. Em uso desde o M5 pelo Testar conexão (Sala de Controle), pelo Concierge (CO-10, janela ⌘K) e pelo Planejador (PL-11, tela Importar o plan.md); sem chave, modelo, preço ou orçamento, falha fechada e o Hub segue sem as funções de IA. Os prompts ficam versionados em `app/src/modules/agents/prompts/`, com histórico.
- **Autorização central**: `authorize(actor, action, resource)` em `src/lib/authorize.ts`. Rotas de API e ferramentas MCP passam por ela antes de tocar o banco. RLS é a segunda linha de defesa, nunca a única nem a inexistente.
- **Erros** no formato `application/problem+json` (RFC 9457). **Paginação** por cursor. **Idempotência** por cabeçalho `Idempotency-Key` em todo POST/PUT de agente.
- **Logs** estruturados (`pino`), sem PII, sem segredos, com `request_id` e `actor`.
- **Banco**: tabelas e colunas em `snake_case` inglês, `uuid` como PK, `created_at/updated_at` em todas, `deleted_at` só onde o PRD pedir soft delete. Enums do Postgres para estados fechados. Toda tabela da aplicação com **RLS habilitada e políticas mínimas**.
- **Migrations**: `supabase/migrations/hub_gestao_NNNN_descricao.sql`, aplicadas pelo MCP `harmony-supabase` com `apply_migration` e nome prefixado `hub_gestao_`. Nunca `execute_sql` para DDL. Depois de cada migration: `get_advisors` (segurança e desempenho) e registrar achados no `PLAN.md`.
- **Códigos de tarefa**: `HUB-<n>` sequencial por workspace (contador no banco). O prefixo é do workspace, não do projeto: tarefas de qualquer projeto da Harmony são `HUB-n`. Imutáveis. Aparecem em UI, API, MCP, `plan.md`, commits e PRs.
- **Textos para cliente** vivem em campos próprios (`title_client`, `description_client`, `summary_client`). Nunca derivar automaticamente do texto interno.
- **UI**: shadcn/ui + Tailwind v4 com tokens Harmony (`PRD.md` §14). Sem emojis. Ícones `lucide-react`. Texto PT-BR. Acessível: foco visível, contraste AA, `lang="pt-BR"`, rótulos e avisos em PT-BR para leitor de tela.
- **Telas que mudam dados**: cada ação de formulário lê o `FormData` com um parser puro e testado, roda o caso de uso numa transação e atualiza a tela; mudança concorrente (versão velha da tarefa, 412) atualiza a tela e avisa. Mensagens de erro para pessoas mostram o nome do campo em PT-BR. Detalhes e regras do Next.js 16 em `app/AGENTS.md`.
- **Testes**: Vitest (unidade e integração) com banco local PGlite (o mesmo Postgres 17), RLS com dois workspaces e papel cliente, e contratos de API e MCP (snapshot do OpenAPI e da lista de tools). Playwright (`app/e2e/`, `npm run e2e`) para os fluxos críticos no navegador: a jornada criar tarefa → mover no Quadro → concluir com evidência → aprovar no Hoje, a revisão de acessibilidade com o axe (WCAG 2.1 A e AA, temas claro e escuro, celular) e a de identidade (fontes, cores, sem emojis) rodam no CI; o portal do cliente entra no M6. Previsto e ainda não feito: Testing Library (componentes).
- **Commits**: PT-BR, imperativo, descritivos. Exemplo: `Adiciona rollup de progresso por marco (HUB-57)`.

## 6. Segurança e acessos

### 6.1 Preflight de identidade (fail-closed)

| Alvo | Como confirmar | Regra |
|---|---|---|
| GitHub | `GH_TOKEN="$(gh auth token --user fabioalmeidadigital)" gh api user --jq .login` → `fabioalmeidadigital` | Repo `Harmony-Digital/hub-gestao`. A conta global do `gh` não é autorizada. O MCP do GitHub está em outra conta: não usar para este repo. `fetch` e `push` com o `GH_TOKEN` exportado e `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' …` (o ajudante padrão usa outra conta e responde "Repository not found"). |
| VPS | `ssh vps-harmony hostname` → `vps-harmony-digital` | KVM4 `1821299`, `217.196.63.157`. Leitura livre; escrita só em `/opt/hub-gestao` e com passo autorizado no `PLAN.md`. Arquivos de Traefik, Compose, systemd e `.env` de produção são do proprietário. O Traefik do EasyPanel é compartilhado: reiniciar derruba todos os sites por alguns segundos, só com ok do Fábio. |
| Banco | MCP `harmony-supabase`: `select schema_name from harmony_admin.projects where slug = 'hub_gestao'` | Trabalhar só em `proj_hub_gestao`. Nunca `proj_*` de outros projetos, nunca `supabase-relgov`, nunca `supabase-leonardo`, nunca schemas globais sem autorização. O servidor do Hub conecta com o papel `hub_gestao_app` (sem `BYPASSRLS`), e a partida recusa papel que ignore a RLS (`src/lib/db/guard.ts`). Escrita no banco de produção pelo terminal é barrada pela proteção da sessão: usar o conector (DDL só por `apply_migration`). |
| DNS | Nenhuma escrita sem ordem do Fábio | O registro `hub` (CNAME → `srv1821299.hstgr.cloud`) existe desde 2026-10-09, criado pela API da Hostinger com autorização dele. Outra mudança só com ordem explícita. Nunca trocar nameservers; a zona hospeda MX/SPF do Microsoft 365 e outros subdomínios. A API pode responder 500 e mesmo assim gravar: conferir a listagem antes de repetir. |
| Vercel | Não se aplica | O Hub roda na VPS. Não criar projeto Vercel para ele. |

### 6.2 Segredos

- Produção: `/opt/hub-gestao/shared/.env.production` (root, `0600`). Local: `app/.env.local` (gitignored). Modelo versionado: `app/.env.example` sem valores.
- A lista completa de variáveis, com onde cada uma vive e quem fornece, está em `docs/credenciais.md`. Em produção, o servidor fala com o banco por `DATABASE_URL` (papel `hub_gestao_app`); o pepper das chaves, a cifra e o segredo do relógio foram gerados na própria VPS e nunca saíram de lá. O link de acesso por e-mail está ligado (`HUB_AUTH_MAGIC_LINK=on`).
- **Chaves de IA (D5)** não ficam em variável de ambiente: o Fábio as cadastra na tela Agentes, e o Hub guarda cifradas em `llm_credentials` com `HUB_ENCRYPTION_KEY`. No computador, o modelo simulado (`HUB_DEV_FAKE_LLM=on`) responde no lugar dos provedores, para conferir as telas de IA sem chave nem custo.
- Chaves de agente são **hash** no banco (`agent_api_keys.key_hash`); o valor em claro aparece uma única vez na criação e nunca é logado.
- Rotação: qualquer suspeita de vazamento → revogar (`revoked_at`) antes de investigar.
- **Senhas de pessoas nunca passam por um agente**: nem cadastrar, nem digitar, nem repetir, mesmo quando pedirem no chat. A pessoa define a sua em `/conta` (Minha conta) ou entra pelo link de acesso por e-mail.
- **Contas de acesso e segurança do servidor são do Fábio**: papel de banco, usuário do servidor, SSH e sudo são executados por ele, por script com botão Rodar (ex.: `deploy/vps/hub-provision-local.sh`). O agente prepara e ensaia o script; não executa.
- Recusa da proteção automática da sessão nunca é contornada: parar, explicar e perguntar ao Fábio.

### 6.3 Dados de clientes (LGPD)

Contatos e conteúdos de clientes ficam no schema do Hub com RLS por `workspace_id` e `project_members`. Exportação e exclusão por cliente são requisitos (PRD §12). Nenhum dado pessoal em logs, prompts de LLM além do necessário ou repositório.

### 6.4 Desenvolvimento local e dados de exemplo

- Sem `DATABASE_URL`, o servidor local usa PGlite em `app/.data/pglite`, com as mesmas migrations e o seed da Harmony.
- **Login de teste**: `HUB_DEV_LOGIN=on` e `HUB_DEV_LOGIN_SECRET` (32 caracteres ou mais) no `app/.env.local` ligam o botão "Entrar como dono, sem senha (só neste computador)" no `/login`. O cookie é assinado com esse segredo. O código fica atrás de `NODE_ENV !== "production"`, e o CI confere que a imagem de produção recusa o cookie e não mostra o botão.
- **Projeto de exemplo**: `HUB_DEV_SAMPLE=on` cria no banco local o cliente "Clínica Exemplo" e o projeto `EXE`, com marcos, frentes, agentes e tarefas de exemplo. Só no banco local.
- `HUB_DEV_AGENT_KEY` registra o "Agente local de teste" para chamar a API e o MCP locais.
- Preview no app Claude: configuração `hub-gestao` (porta 3100), que sobe com `WATCHPACK_POLLING=true` e `HUB_DEV_POLL_MS=1000`. Com muitos servidores abertos no Mac, o macOS esgota os observadores de arquivos (EMFILE ou "unable to start FSEvent stream"); `HUB_DEV_POLL_MS` faz o `next dev` observar por consulta periódica (`watchOptions.pollIntervalMs` no `next.config.ts`), só quando a variável existe.
- Conferência visual no computador (1440 px) e no celular (375 px), olhando o console do navegador e o log do servidor.

## 7. Regras de negócio que não podem quebrar

1. **Visibilidade** (`internal | client`) é verificada por RLS e por `authorize()`. Operacional é sempre `internal`. Comentários nascem `internal`.
2. **Rollup determinístico**: progresso da frente = tarefas concluídas / tarefas (ponderadas por `estimate_minutes` quando houver); progresso do marco = média ponderada das frentes + tarefas soltas; saúde do projeto = regra em código (atrasos, bloqueios, deriva de prazo). Nunca via LLM.
3. **🔒 GATE**: aceite de marco só por humano com papel `owner` ou `admin`; o cliente nunca aceita marco, no máximo confirma o recebimento (D9). API e MCP recusam. Sincronização de `plan.md` ignora `[x]` em linha de GATE e abre alerta.
4. **Conclusão exige evidência** (`done_evidence` não vazio). O serviço exige sempre; o banco reforça nos projetos com `require_evidence = true` (padrão da Harmony).
5. **Idempotência**: mesma `Idempotency-Key` + mesmo corpo → mesma resposta; corpo diferente → `409`.
6. **Auditoria**: toda mutação grava `activity_log` com `actor_type`, `actor_id`, `source` (`ui | api | mcp | sync | cron | webhook`), `before` e `after`. A tabela é append-only (sem UPDATE/DELETE para a aplicação).
7. **Escopo de chave**: uma chave de agente só vê e altera os projetos listados em `scopes.project_ids` (ou todos, se `workspace:*` e o Fábio autorizou). Ações de escrita exigem `tasks:write`; aprovações exigem `approvals:request` e nunca `approvals:decide`.
8. **Teto de custo de IA**: cada agente interno tem orçamento mensal (`agents.budget_usd_month`); estourou, o agente responde com texto determinístico e registra o evento.
9. **Mudança de status pela tela** (Lista, painel e Quadro) passa pelo caso de uso `moveTask`: concluir pede evidência, bloquear pede o motivo, tarefa concluída é reaberta antes de ir para outro status, e a versão lida é conferida (se outra pessoa ou agente mudou a tarefa, nada é gravado e a tela avisa). Agentes usam as ações próprias (`start`, `block`, `complete`, `reopen`); o `start` aplica o limite de tarefas em andamento por agente.

## 8. Deploy e operação (resumo; detalhes no `PRD.md` §13 e em `deploy/vps/README.md`)

- Merge na `main` → CI **"Qualidade"**: formato, lint, tipos, testes e build, os testes de ponta a ponta (Playwright, no `next dev` com banco local novo), mais a imagem de produção testada com as restrições da VPS (inclusive a recusa do login de teste) → **"Publicação na VPS"** (só com a variável `HUB_DEPLOY_ENABLED=true`): imagem sem segredos enviada por SSH restrito (usuário `hubdeploy`, só o comando `load <sha>`) → troca do contêiner → saúde em `/api/health` com o SHA → volta à versão anterior se falhar. Mesmo padrão do Certato, com nomes `hub-*`.
- Contêiner `hub-app`: usuário 1001, sistema de arquivos somente leitura, sem capabilities, limites de 1,5 CPU e 2 GB, redes `hub_proxy` (Traefik) e `supabase_default` (banco). Rota do Traefik em `/etc/easypanel/traefik/config/hub.yaml`, com Let's Encrypt e cabeçalhos de segurança.
- Jobs determinísticos: timer `hub-cron` a cada 5 minutos chama o relógio de dentro do contêiner (`app/scripts/cron-tick.mjs`), que roda `health-rollup` (15 min), `approval-aging`, `evidence-check` e `agent-spend` (1 h), `webhook-dispatch` (1 min) e `idempotency-cleanup` (1 h). Raciocínio de agentes fica no Hermes.
- Backup (D8): timer `hub-backup` diário às 06:00 UTC, `pg_dump` do schema com 14 dias de retenção em `/opt/hub-gestao/backups`. A cópia fora da VPS espera o destino escolhido pelo Fábio.
- Encerrar entrega: CI e publicação verdes, `/api/health` com o SHA publicado, smoke test real (tela atrás de login, tarefa via MCP, ver no quadro).

## 9. Definição de pronto (DoD) de uma tarefa deste repositório

- Código + testes + `npm run check` verde.
- Migration aplicada e advisors sem achados críticos (quando houver banco).
- Verificação real registrada (comando, URL ou consulta) no `PLAN.md`.
- Documentação tocada (`docs/`, `README`, OpenAPI, lista de tools MCP) quando a interface pública mudou.
- Nenhum segredo, nenhum dado pessoal, nenhum emoji novo na UI.

---

## Parte B — Protocolo do Agente Operador

> Vale para qualquer agente que **usa** o Hub: o Gestor de Projetos no Hermes, Kratos, uma sessão de Claude Code ou Codex trabalhando num projeto cliente, um fluxo n8n. O catálogo completo de agentes está em `AGENTES.md`.

## 10. Como um agente entra no Hub

1. Recebe uma **chave de agente** (`hub_ak_…`) criada pelo Fábio na tela **Agentes** (`/agentes`, no ar desde 2026-10-10). A chave tem escopos, projetos e validade, e o valor aparece uma única vez.
2. Conecta por **MCP** (`https://hub.harmonydigital.com.br/mcp`, Streamable HTTP, `Authorization: Bearer <chave>`) ou por **REST** (`/api/v1`, mesmo cabeçalho). Claude Code e Codex: registrar o servidor MCP no projeto cliente (passo a passo em `docs/agentes-conexao.md`). No Mac do Fábio, `scripts/conectar-claude-code.sh` guarda a chave nas Chaves do macOS e escreve a configuração sem segredo; `scripts/teste-mcp-producao.sh` faz o teste completo (provado em 2026-10-10 com a HUB-1). Hermes: registrar nos `mcp_servers` do `~/.hermes/config.yaml` do Kratos (formato, rotinas e webhooks do Hermes em `agents/hermes/README.md`; a versão instalada ainda vai ser conferida por dentro do contêiner).
3. Primeira chamada sempre `hub_whoami`: confirma identidade, workspace, projetos permitidos e escopos. Se não bater com o esperado, parar.
4. Toda escrita leva chave de idempotência: no MCP, o campo `idempotency_key` (obrigatório, uma por escrita); na REST, o cabeçalho `Idempotency-Key`.

## 11. Ciclo de trabalho do agente executor (Claude Code / Codex num projeto cliente)

```
hub plan pull                      # início de sessão: traz o plan.md atualizado do Hub
hub_get_today / hub_list_tasks     # fila: minhas tarefas, ordem de prioridade, bloqueios
hub_start_task(code)               # UMA tarefa em andamento por agente (salvo lote autorizado)
… trabalho real …
hub_comment(code, texto)           # progresso relevante, decisões técnicas, dúvidas (interno)
hub_block_task(code, motivo, waiting_on?)  # bloqueio: dizer o que falta e de quem depende; waiting_on indica quem destrava (pessoa ou agente), que recebe aviso
hub_complete_task(code, evidence)  # evidência obrigatória: SHA, URL, arquivo, teste
hub_create_task(...)               # trabalho descoberto: nível operacional, ligado à frente/pai
hub plan push                      # fim de sessão: devolve o estado ao Hub e regrava o plan.md
```

A CLI `hub` (`packages/cli`, instalação e uso em `docs/cli.md`) faz o ciclo acima com a chave em `HUB_API_KEY`. Sem a CLI, o `hub plan pull` e o `hub plan push` se fazem pelo `hub_sync_plan` (MCP) ou pelo `POST /api/v1/sync/plan` (REST), com o conteúdo do `plan.md` (`direction` `pull` ou `push`): grave no repositório o `markdown` devolvido. No push, mande `commit_sha` quando houver commit e, para que desmarcar, renomear e apagar itens tenham efeito, `base_markdown` (o arquivo da última sincronização). A chave precisa de `sync:plan` e, para o push criar e concluir tarefas, de `tasks:write` e `tasks:complete` (frente nova pede `workstreams:write`). Regras do formato e da sincronização em `docs/plan-md.md`. Só para ler o plano, `hub_get_plan` (JSON ou `plan.md`). Nos commits, cite o código (`Ajusta o fluxo (HUB-12)`) e, quando o commit entrega a tarefa, escreva `fecha HUB-12`: com o webhook do GitHub ligado, a citação vira comentário na tarefa e o "fecha" no ramo principal vira proposta de conclusão (`docs/github-webhook.md`); a conclusão continua sendo sua, com a evidência.

Regras:
- **Nunca** marcar GATE, nunca mudar prazo de marco, nunca criar marco. Isso é `hub_request_approval` (pedido) para o Fábio decidir.
- **Nunca** escrever em campos `*_client` nem comentários `visibility = client`. Texto para cliente passa pelo Redator do Cliente e por aprovação.
- **Nunca** colocar segredos, tokens, senhas ou dados pessoais em título, descrição, comentário ou evidência.
- Tarefa concluída sem evidência é reaberta pelo Guardião da Qualidade. Não discutir: anexar evidência.
- Se o `plan.md` local e o Hub divergirem, o Hub vence; o agente relata a divergência em comentário em vez de "consertar" por conta.
- Para chamar a atenção de uma pessoa num comentário, cite-a em `mentions` do `hub_comment` (ou da REST): ela recebe aviso na caixa de entrada do Hub. Não cite à toa.
- **Projeto arquivado** é só consulta: qualquer escrita nele volta 422 com `archived: true`. Não tentar de novo; parar e avisar quem pediu o trabalho. Arquivar e restaurar são decisões de pessoa, pela tela.

## 12. Ciclo do agente de gestão (Hermes)

> **D6 (2026-10-09):** na fase 1, todos os papéis abaixo são skills do **Kratos**, com uma única chave e o campo `papel` em cada escrita. Ele também é o importador dos projetos (D10).

- **Gestor de Projetos**: lê marcos, saúde e riscos de todos os projetos do escopo; propõe replanejamento como **rascunho** (`hub_request_approval` do tipo `replan`); redige o resumo executivo semanal; nunca altera escopo sozinho.
- **Coordenador Tático**: quebra marcos aprovados em frentes e tarefas (criação permitida na camada operacional e tática), prioriza a fila diária por departamento, atribui a agentes/pessoas, cobra bloqueios, publica o digest matinal no Telegram (via Hermes) e no inbox do Hub.
- **Relator de Status**: gera rascunhos de status (interno e para cliente) a partir de dados reais; cada rascunho vira `approval` pendente. Só depois do "sim" do Fábio o Hub publica no portal ou envia.
- **Guardião da Qualidade**: verifica conclusões (evidência, DoD, consistência `plan.md` ↔ Hub), reabre o que não tem prova, aponta tarefas duplicadas.
- **Vigia de Prazos e Riscos**: regra determinística no Hub detecta atraso, deriva e dependência quebrada; o agente só explica e sugere ação.
- Horário de silêncio 23h–8h para notificações proativas. Não repetir o mesmo alerta em menos de 24h sem mudança de estado.

## 13. Decisões do Fábio

As decisões D1–D11 foram tomadas em 2026-10-09 e estão em `PLAN.md` → **Decisões do Fábio** e no `PRD.md` §19. Decisão nova segue a mesma regra: um agente não "escolhe" pelo Fábio; executa com o padrão recomendado e deixa o item aberto para confirmação.

## 14. Glossário

- **Workspace**: a empresa dona da instância (Harmony hoje; cada cliente do produto, no futuro).
- **Cliente**: empresa atendida pelo workspace; dona de projetos; acessa o portal.
- **Projeto**: unidade de entrega para um cliente (ou interno), com fases Descobrir → Validar → Escalar.
- **Marco**: entrega estratégica com data e aceite (camada estratégica).
- **Frente**: pacote de trabalho de um departamento rumo a um marco (camada tática).
- **Tarefa / Subtarefa**: unidade operacional, com código `HUB-n` (camada operacional).
- **Departamento**: área transversal (Estratégia, Marketing e Vendas, Agentes e Automações, Sistemas, Design, Dados, Gestão, Administrativo/Financeiro, Sucesso do Cliente).
- **Agente**: operador de IA cadastrado no Hub, com chave, escopo e departamento.
- **Aprovação (gate)**: pedido de decisão humana registrado em `approvals`.
- **Evidência**: prova verificável de conclusão.
- **Portal**: visão do cliente, filtrada pelas camadas estratégica e tática.
