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

Mapeamento com o `plan.md` de cada projeto: `## Marco` = Marco · `### Seção` = Frente · `- [ ] item (HUB-123)` = Tarefa · item aninhado = Subtarefa · linha `🔒 GATE` = pedido de aceite do marco (aprovação humana).

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
6. Testar de verdade: navegador (`npm run dev`), banco (consulta read-only), API (`curl` ou teste), MCP (cliente de teste). Nada é verificado "por leitura de código".
7. Descobriu trabalho novo? Adicionar tarefa `[ ]` no milestone certo, nunca executar escopo futuro sem pedido.

**Fim**
8. `npm run check` verde.
9. Atualizar `PLAN.md`: marcar `[x]` só o verificado, com evidência curta; adicionar linha no **Registro de Execução** (data, IA, entregue, pendências).
10. Commit com mensagem descritiva em PT-BR, `git add` com caminhos explícitos. Push só quando o `PLAN.md` ou o Fábio autorizar.
11. Se algo ficou quebrado ou pela metade, dizer isso explicitamente na última mensagem.

## 5. Stack e convenções de código

### 5.1 Estrutura prevista do repositório `Harmony-Digital/hub-gestao`

```
hub-gestao/
├── AGENTS.md · CLAUDE.md · PRD.md · AGENTES.md · PLAN.md · README.md
├── app/                      # Next.js 16 (App Router) — web + API + MCP
│   ├── src/app/(app)/…       # interface interna (shell, projetos, visões, hoje, aprovações, agentes)
│   ├── src/app/portal/…      # portal do cliente (rota pública autenticada por magic link)
│   ├── src/app/api/v1/…      # REST para agentes e integrações (OpenAPI 3.1)
│   ├── src/app/api/internal/ # cron, health, webhooks de entrada (GitHub)
│   ├── src/app/mcp/route.ts  # servidor MCP Streamable HTTP
│   ├── src/modules/          # domínio por módulo: projects, tasks, milestones, approvals, agents, sync, reports, portal
│   ├── src/lib/              # supabase clients, auth, authorize(), audit, idempotency, llm adapter, tokens
│   ├── src/components/       # UI (shadcn/ui + componentes Harmony)
│   └── tests/                # Vitest unit/integration · e2e Playwright
├── packages/cli/             # CLI `hub` (Node) — `hub plan pull|push`, `hub task done HUB-123`
├── supabase/
│   ├── migrations/           # hub_gestao_0001_foundation.sql, hub_gestao_0002_…sql
│   └── tests/                # SQL de RLS com dois workspaces e papel cliente
├── deploy/vps/               # Dockerfile, docker-compose.yml, traefik.yml, systemd, deploy.sh (padrão RELGOV)
├── agents/hermes/            # SOUL/AGENTS/skills do Gestor de Projetos e demais agentes Hermes (sem segredos)
├── docs/                     # ADRs, API, MCP, design system, operação
└── .github/workflows/        # ci.yml (lint/types/test/build) · deploy-vps.yml
```

### 5.2 Convenções

- **TypeScript estrito**, sem `any` implícito. `zod` em todas as fronteiras (API, MCP, formulários, env).
- **Server-only** para `service_role`, chaves de LLM e qualquer segredo (`import 'server-only'`). O navegador só usa a `anon key` com sessão do usuário e RLS.
- **IA multi-provedor (D5)**: nenhum código chama SDK de provedor diretamente. Tudo passa por `src/lib/llm` (AI SDK v7 com Anthropic, OpenAI e xAI), que lê provedor, modelo e credencial da configuração do agente a cada chamada. Trocar de provedor é configuração, nunca deploy.
- **Autorização central**: `authorize(actor, action, resource)` em `src/lib/authorize.ts`. Rotas de API e ferramentas MCP passam por ela antes de tocar o banco. RLS é a segunda linha de defesa, nunca a única nem a inexistente.
- **Erros** no formato `application/problem+json` (RFC 9457). **Paginação** por cursor. **Idempotência** por cabeçalho `Idempotency-Key` em todo POST/PUT de agente.
- **Logs** estruturados (`pino`), sem PII, sem segredos, com `request_id` e `actor`.
- **Banco**: tabelas e colunas em `snake_case` inglês, `uuid` como PK, `created_at/updated_at` em todas, `deleted_at` só onde o PRD pedir soft delete. Enums do Postgres para estados fechados. Toda tabela da aplicação com **RLS habilitada e políticas mínimas**.
- **Migrations**: `supabase/migrations/hub_gestao_NNNN_descricao.sql`, aplicadas pelo MCP `harmony-supabase` com `apply_migration` e nome prefixado `hub_gestao_`. Nunca `execute_sql` para DDL. Depois de cada migration: `get_advisors` (segurança e desempenho) e registrar achados no `PLAN.md`.
- **Códigos de tarefa**: `HUB-<n>` sequencial por workspace (sequence no banco). Imutáveis. Aparecem em UI, API, MCP, `plan.md`, commits e PRs.
- **Textos para cliente** vivem em campos próprios (`title_client`, `description_client`, `summary_client`). Nunca derivar automaticamente do texto interno.
- **UI**: shadcn/ui + Tailwind v4 com tokens Harmony (`PRD.md` §14). Sem emojis. Ícones `lucide-react`. Texto PT-BR. Acessível: foco visível, contraste AA, `lang="pt-BR"`.
- **Testes**: Vitest (unidade e integração), Testing Library (componentes), Playwright (fluxos críticos: criar tarefa, concluir com evidência, aprovação, portal do cliente), SQL de RLS (dois workspaces + papel cliente), contratos de API e MCP (snapshot do OpenAPI e da lista de tools).
- **Commits**: PT-BR, imperativo, descritivos. Exemplo: `Adiciona rollup de progresso por marco (HUB-57)`.

## 6. Segurança e acessos

### 6.1 Preflight de identidade (fail-closed)

| Alvo | Como confirmar | Regra |
|---|---|---|
| GitHub | `GH_TOKEN="$(gh auth token --user fabioalmeidadigital)" gh api user --jq .login` → `fabioalmeidadigital` | Repo `Harmony-Digital/hub-gestao`. A conta global do `gh` não é autorizada. O MCP do GitHub está em outra conta: não usar para este repo. |
| VPS | `ssh vps-harmony hostname` → `vps-harmony-digital` | KVM4 `1821299`, `217.196.63.157`. Leitura livre; escrita só em `/opt/hub-gestao` e com passo autorizado no `PLAN.md`. Arquivos de Traefik, Compose, systemd e `.env` de produção são do proprietário. |
| Banco | MCP `harmony-supabase`: `select schema_name from harmony_admin.projects where slug = 'hub_gestao'` | Trabalhar só em `proj_hub_gestao`. Nunca `proj_*` de outros projetos, nunca `supabase-relgov`, nunca `supabase-leonardo`, nunca schemas globais sem autorização. |
| DNS | Nenhuma escrita | Registro `hub` é criado pelo Fábio (ou com autorização explícita). Nunca trocar nameservers; a zona hospeda MX/SPF do Microsoft 365 e outros subdomínios. |
| Vercel | Não se aplica | O Hub roda na VPS. Não criar projeto Vercel para ele. |

### 6.2 Segredos

- Produção: `/opt/hub-gestao/shared/.env.production` (root, `0600`). Local: `app/.env.local` (gitignored). Modelo versionado: `app/.env.example` sem valores.
- Variáveis mínimas: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `HUB_API_KEY_PEPPER`, `HUB_ENCRYPTION_KEY`, `CRON_SECRET`, `RESEND_API_KEY` (fase do portal), `GITHUB_WEBHOOK_SECRET`, `LLM_MONTHLY_BUDGET_USD`.
- **Chaves de IA (D5)** não ficam no `.env` de produção: o Fábio as cadastra na tela Agentes, e o Hub guarda cifradas em `llm_credentials` com `HUB_ENCRYPTION_KEY`. Em desenvolvimento local, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` e `XAI_API_KEY` no `.env.local` servem só de fallback.
- Chaves de agente são **hash** no banco (`agent_api_keys.key_hash`); o valor em claro aparece uma única vez na criação e nunca é logado.
- Rotação: qualquer suspeita de vazamento → revogar (`revoked_at`) antes de investigar.

### 6.3 Dados de clientes (LGPD)

Contatos e conteúdos de clientes ficam no schema do Hub com RLS por `workspace_id` e `project_members`. Exportação e exclusão por cliente são requisitos (PRD §12). Nenhum dado pessoal em logs, prompts de LLM além do necessário ou repositório.

## 7. Regras de negócio que não podem quebrar

1. **Visibilidade** (`internal | client`) é verificada por RLS e por `authorize()`. Operacional é sempre `internal`. Comentários nascem `internal`.
2. **Rollup determinístico**: progresso da frente = tarefas concluídas / tarefas (ponderadas por `estimate_minutes` quando houver); progresso do marco = média ponderada das frentes + tarefas soltas; saúde do projeto = regra em código (atrasos, bloqueios, deriva de prazo). Nunca via LLM.
3. **🔒 GATE**: aceite de marco só por humano com papel `owner` ou `admin`; o cliente nunca aceita marco, no máximo confirma o recebimento (D9). API e MCP recusam. Sincronização de `plan.md` ignora `[x]` em linha de GATE e abre alerta.
4. **Conclusão exige evidência** (`done_evidence` não vazio) quando a tarefa pertence a um projeto com `require_evidence = true` (padrão da Harmony).
5. **Idempotência**: mesma `Idempotency-Key` + mesmo corpo → mesma resposta; corpo diferente → `409`.
6. **Auditoria**: toda mutação grava `activity_log` com `actor_type`, `actor_id`, `source` (`ui | api | mcp | sync | cron | webhook`), `before` e `after`. A tabela é append-only (sem UPDATE/DELETE para a aplicação).
7. **Escopo de chave**: uma chave de agente só vê e altera os projetos listados em `scopes.project_ids` (ou todos, se `workspace:*` e o Fábio autorizou). Ações de escrita exigem `tasks:write`; aprovações exigem `approvals:request` e nunca `approvals:decide`.
8. **Teto de custo de IA**: cada agente interno tem orçamento mensal (`agents.budget_usd_month`); estourou, o agente responde com texto determinístico e registra o evento.

## 8. Deploy e operação (resumo; detalhes no `PRD.md` §13)

- Push em `main` → GitHub Actions: lint, typecheck, testes, build → imagem Docker sem segredos → SSH restrito à VPS (`load <sha>`) → troca do container → healthcheck em `/api/health` → rollback automático se falhar. Igual ao RELGOV, com nomes `hub-*`.
- Container `hub-app` sem root, filesystem somente leitura, rede `hub_proxy`, limites iniciais 1,5 CPU e 2 GB. Traefik roteia `hub.harmonydigital.com.br`.
- Jobs determinísticos (rollups, lembretes, digests, limpeza) por `systemd timer` → `POST /api/internal/cron/<job>` com `CRON_SECRET`. Raciocínio de agentes fica no Hermes.
- Encerrar entrega: run verde, `/api/health` com o SHA publicado, smoke test real (login, criar tarefa via MCP, ver no quadro).

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

1. Recebe uma **chave de agente** (`hub_ak_…`) criada pelo Fábio na tela **Agentes** (ou pela API, com papel `owner`). A chave tem `scopes` e `project_ids`.
2. Conecta por **MCP** (`https://hub.harmonydigital.com.br/mcp`, Streamable HTTP, `Authorization: Bearer <chave>`) ou por **REST** (`/api/v1`, mesmo cabeçalho). Claude Code e Codex: registrar o servidor MCP no projeto cliente. Hermes: registrar nos `mcp_servers` da configuração do agente (confirmar formato na versão instalada; alternativa: skill que chama a REST).
3. Primeira chamada sempre `hub_whoami`: confirma identidade, workspace, projetos permitidos e escopos. Se não bater com o esperado, parar.

## 11. Ciclo de trabalho do agente executor (Claude Code / Codex num projeto cliente)

```
hub plan pull                      # início de sessão: traz o plan.md atualizado do Hub
hub_get_today / hub_list_tasks     # fila: minhas tarefas, ordem de prioridade, bloqueios
hub_start_task(code)               # UMA tarefa em andamento por agente (salvo lote autorizado)
… trabalho real …
hub_comment(code, texto)           # progresso relevante, decisões técnicas, dúvidas (interno)
hub_block_task(code, motivo)       # bloqueio: dizer o que falta e de quem depende
hub_complete_task(code, evidence)  # evidência obrigatória: SHA, URL, arquivo, teste
hub_create_task(...)               # trabalho descoberto: nível operacional, ligado à frente/pai
hub plan push                      # fim de sessão: devolve o estado ao Hub e regrava o plan.md
```

Regras:
- **Nunca** marcar GATE, nunca mudar prazo de marco, nunca criar marco. Isso é `hub_request_approval` (pedido) para o Fábio decidir.
- **Nunca** escrever em campos `*_client` nem comentários `visibility = client`. Texto para cliente passa pelo Redator do Cliente e por aprovação.
- **Nunca** colocar segredos, tokens, senhas ou dados pessoais em título, descrição, comentário ou evidência.
- Tarefa concluída sem evidência é reaberta pelo Guardião da Qualidade. Não discutir: anexar evidência.
- Se o `plan.md` local e o Hub divergirem, o Hub vence; o agente relata a divergência em comentário em vez de "consertar" por conta.

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
