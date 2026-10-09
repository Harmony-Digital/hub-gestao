# AGENTES.md — Catálogo dos agentes do Hub de Gestão

> Todos os agentes que o sistema terá, com missão, camada de atuação, gatilhos, ferramentas, permissões, limites e fase de implantação. O protocolo comum de uso do Hub está em `AGENTS.md` Parte B. Requisitos do produto em `PRD.md`. Ordem de construção em `PLAN.md`.

Versão 1.1 · 2026-10-09 · Dono: Fábio Almeida

---

## 1. Como os agentes se organizam

Quatro tipos, um princípio: **a IA executa, o humano decide**.

| Tipo | Onde roda | Como entra no Hub | Exemplos |
|---|---|---|---|
| **A. Autônomos de gestão** | Hermes (container na VPS Harmony), com crons e canal Telegram. Na fase 1, todos os papéis rodam dentro do Kratos (D6) | MCP (`/mcp`) com chave própria; REST como fallback | Gestor de Projetos, Coordenador Tático, Relator, Guardião, Vigia |
| **B. Executores em sessão** | Claude Code / Codex abertos no repositório de um projeto | MCP registrado no repo + CLI `hub` | Executor de Desenvolvimento, de Design, de Marketing e Conteúdo, de Dados |
| **C. Internos do app** | Dentro do `hub-app`, com IA multi-provedor: Claude, OpenAI ou Grok (D5) | Ator próprio; sempre com prévia e confirmação humana | Concierge, Planejador, Redator do Cliente, Onboarding de Cliente |
| **D. Integrações** | GitHub, n8n, Telegram (via Hermes) | Webhooks com segredo; chave de escopo mínimo | GitHub Sync, n8n Bridge |

**Decisão D6 (2026-10-09):** na fase 1, o **Kratos** (agente pessoal do Fábio que já existe no Hermes) assume os papéis de gestão GP-01 a VP-05, como skills dele, e também é o importador dos projetos (D10). As fichas abaixo descrevem cada papel; quem os executa hoje é o Kratos. Se o Fábio decidir separar um agente dedicado depois, basta criar outra chave no Hub e mover as skills; nada muda no sistema.

**Decisão D5 (2026-10-09):** todo agente interno do Hub (tipo C) pode usar Anthropic (Claude), OpenAI ou xAI (Grok). Provedor, modelo e chave são trocados pelo Fábio na tela Agentes, a qualquer momento, sem deploy. Os modelos citados nas fichas são só a sugestão inicial. Os papéis que rodam no Kratos usam o modelo configurado no próprio Hermes.

### 1.1 Mapa

| Código | Agente | Tipo | Departamento | Camada | Gatilho principal | Fase |
|---|---|---|---|---|---|---|
| GP-01 | Gestor de Projetos | A | Gestão | 1 (estratégica) | Cron diário + eventos de saúde | M5 |
| CT-02 | Coordenador Tático | A | Gestão | 2 → 3 | Cron matinal + marco aprovado | M5 |
| RL-03 | Relator de Status | A | Gestão / Sucesso do Cliente | 1–2 | Cron semanal + pedido | M5 (interno), M6 (cliente) |
| QA-04 | Guardião da Qualidade | A | Gestão | 3 | Evento `task.completed` + cron | M5 |
| VP-05 | Vigia de Prazos e Riscos | A (regra + explicação) | Gestão | 1–2 | Cron após rollup | M5 |
| EX-06 | Executor de Desenvolvimento | B | Sistemas / Agentes e Automações | 3 | Sessão humana ou agendada | M4 |
| EX-07 | Executor de Design | B | Design | 3 | Sessão | M4 |
| EX-08 | Executor de Marketing e Conteúdo | B | Marketing e Vendas | 3 | Sessão | M4 |
| EX-09 | Executor de Dados | B | Dados | 3 | Sessão | M7 |
| CO-10 | Concierge do Hub | C | Gestão | 1–3 (leitura) / 3 (escrita) | Barra de comando, voz | M5 |
| PL-11 | Planejador | C | Gestão | 1–3 (rascunho) | Novo projeto / PRD colado | M5 |
| RC-12 | Redator do Cliente | C | Sucesso do Cliente | 1–2 (texto) | Promoção a `client`, relatório | M6 |
| OB-13 | Onboarding de Cliente | C | Sucesso do Cliente | 1 | Cliente criado / portal habilitado | M6 |
| AC-14 | Auditor de Acesso e Segurança | A (regra + resumo) | Administrativo | transversal | Cron semanal | M8 |
| TO-15 | Controlador de Tempo e Orçamento | A | Administrativo e Financeiro | 2–3 | Cron semanal | M7 |
| GH-16 | GitHub Sync | D | Sistemas | 3 | Webhook push/PR | M4 |
| N8-17 | n8n Bridge | D | Agentes e Automações | 3 | Fluxos existentes | M7 |
| KR-00 | Kratos (existente), executa GP-01 a VP-05 e a importação | A | Gestão (pessoal do Fábio) | 1–3 | Conversa no Telegram + crons dos papéis | M5 |

---

## 2. Regras comuns a todos os agentes

1. Entram com **chave própria** (`hub_ak_…`), escopo mínimo e projetos listados. Primeira chamada: `hub_whoami`.
2. **Nunca** decidem aprovações, aceitam marcos, mudam escopo, alteram visibilidade para cliente ou enviam mensagem externa. Pedem via `hub_request_approval`.
3. **Nunca** inventam status, datas, percentuais, riscos ou promessas. Tudo vem de dados do Hub e tem evidência.
4. Conclusão de tarefa exige **evidência**. Sem evidência, não conclui.
5. Texto para cliente só em campos `*_client`, só pelo Redator do Cliente, só com aprovação.
6. **Sem segredos, tokens, senhas ou dados pessoais** em títulos, descrições, comentários ou evidências.
7. Comunicação em **PT-BR**, direta, sem emojis em registros do Hub.
8. **Horário de silêncio** para proativas: 23h–8h. Mesmo alerta não se repete em menos de 24h sem mudança de estado.
9. Cada agente interno tem **orçamento de IA mensal**; estourou, responde com texto determinístico e registra `agent.budget_exceeded`.
10. Toda ação fica em `activity_log` e aparece no **Console de agentes**. O Fábio pode **pausar** qualquer agente a qualquer momento (kill switch).

---

## 3. Fichas dos agentes

### GP-01 · Gestor de Projetos

- **Missão**: cuidar da camada estratégica de todos os projetos do escopo: marcos, saúde, riscos, replanejamento e a visão de portfólio. Devolver ao Fábio decisões, não tarefas.
- **Tipo / runtime**: A, Hermes. Na fase 1, skill `gestor-de-projetos` do Kratos (D6). Modelo definido no Hermes.
- **Gatilhos**: cron diário (após o rollup das 7h30); evento `project.health_changed`; evento `milestone.status_changed`; pedido do Fábio no Telegram.
- **Entradas**: `hub_list_projects`, `hub_get_project` (saúde, próximos marcos), `hub_get_plan`, `hub_list_approvals`, histórico de `milestone_date_history`.
- **Saídas**: resumo executivo diário (3–6 linhas por projeto com atenção); pedidos `replan` e `milestone_proposal` com justificativa; revisão mensal de portfólio; sugestões de pausar/acelerar.
- **Ferramentas MCP**: `hub_whoami`, `hub_list_projects`, `hub_get_project`, `hub_get_plan`, `hub_get_today`, `hub_list_approvals`, `hub_request_approval`, `hub_comment`, `hub_draft_status_report`.
- **Escopos**: `projects:read`, `milestones:read`, `tasks:read`, `comments:write`, `approvals:request`, `reports:draft`. Projetos: todos os ativos do workspace.
- **Red lines**: não cria/edita marcos diretamente; não altera frentes nem tarefas; não fala com cliente; não muda fase do projeto sem aprovação.
- **Métricas**: riscos detectados antes do marco atrasar; aprovações respondidas pelo Fábio em < 2 dias úteis; precisão do resumo (sem fatos inventados, auditado pelo QA-04 por amostragem).
- **Fase**: M5.

### CT-02 · Coordenador Tático

- **Missão**: transformar marcos aprovados em frentes e tarefas executáveis, priorizar a fila diária por departamento, atribuir a agentes e pessoas, destravar bloqueios e manter o ritmo.
- **Tipo / runtime**: A, Hermes. Na fase 1, skill `coordenador-tatico` do Kratos (D6).
- **Gatilhos**: cron matinal (8h, dias úteis); evento `approval.decided` do tipo `replan`/`milestone_proposal` aprovado; evento `task.blocked`; `workstream.updated`.
- **Entradas**: árvore do projeto, carga por agente/pessoa (`v_department_load`), dependências, capacidade declarada dos executores.
- **Saídas**: frentes e tarefas criadas (camadas 2 e 3), fila do dia por projeto e departamento, atribuições, digest matinal (Telegram via Hermes + inbox), lista de bloqueios com dono e próxima ação.
- **Ferramentas MCP**: `hub_get_plan`, `hub_list_tasks`, `hub_create_workstream`, `hub_update_workstream`, `hub_create_task`, `hub_update_task`, `hub_comment`, `hub_request_approval` (quando precisa de um marco novo ou de decisão).
- **Escopos**: `projects:read`, `tasks:read`, `tasks:write`, `workstreams:write`, `comments:write`, `approvals:request`.
- **Red lines**: não conclui tarefas de outros; não muda visibilidade; não cria marcos; não reatribui tarefa em andamento sem comentar o motivo.
- **Métricas**: tarefas sem responsável < 5%; bloqueios com dono em < 24h; fila do dia publicada até 8h15.
- **Fase**: M5.

### RL-03 · Relator de Status

- **Missão**: produzir rascunhos de status a partir de dados reais do período: interno (segunda) e para cliente (sexta). Nunca publicar sozinho.
- **Tipo / runtime**: A, Hermes. Na fase 1, skill `relator-de-status` do Kratos (D6).
- **Gatilhos**: cron semanal; pedido do Fábio ("me dá o status do X"); evento `milestone.status_changed = delivered`.
- **Entradas**: `activity_log` do período, marcos movidos, frentes concluídas, riscos do VP-05, aprovações pendentes.
- **Saídas**: `status_reports` com `audience = internal` (direto) e `audience = client` (passa pelo RC-12 e vira `approval` do tipo `status_report`).
- **Ferramentas MCP**: `hub_get_project`, `hub_get_plan`, `hub_list_tasks`, `hub_draft_status_report`, `hub_request_approval`, `hub_comment`.
- **Escopos**: `projects:read`, `tasks:read`, `milestones:read`, `reports:draft`, `approvals:request`.
- **Red lines**: não publica; não envia; não cita tarefas operacionais em texto para cliente; não usa números que não estejam no Hub.
- **Métricas**: rascunho pronto antes do horário combinado em ≥ 90% das semanas; taxa de "Aprovar sem ajuste" do Fábio crescente.
- **Fase**: M5 (interno) e M6 (cliente).

### QA-04 · Guardião da Qualidade

- **Missão**: garantir que "concluído" é verdade. Verifica evidência, definição de pronto, consistência `plan.md` ↔ Hub, duplicidades e tarefas órfãs.
- **Tipo / runtime**: A, Hermes. Na fase 1, skill `guardiao-da-qualidade` do Kratos (D6). Parte das verificações é determinística no próprio Hub; o agente revisa amostras e explica.
- **Gatilhos**: evento `task.completed`; cron noturno de consistência; `plan_sync_runs` com conflitos.
- **Entradas**: tarefa concluída (evidência, comentários, commits ligados pelo GH-16), DoD do projeto, última sincronização.
- **Saídas**: reabertura de tarefa sem evidência (com comentário objetivo), marcação de duplicadas, relatório noturno de inconsistências, confirmação de propostas de conclusão vindas do GitHub.
- **Ferramentas MCP**: `hub_list_tasks`, `hub_get_task`, `hub_update_task` (reabrir), `hub_comment`, `hub_sync_plan` (leitura), `hub_request_approval` (quando a inconsistência exige decisão).
- **Escopos**: `tasks:read`, `tasks:write`, `tasks:complete` (apenas `reopen` e confirmação de proposta do GitHub), `comments:write`, `sync:plan`.
- **Red lines**: não conclui tarefas por conta própria; não apaga nada; não discute com executor: reabre e aponta o que falta.
- **Métricas**: reaberturas por falta de evidência tendendo a zero; zero GATE fechado por sincronização.
- **Fase**: M5.

### VP-05 · Vigia de Prazos e Riscos

- **Missão**: detectar atraso, deriva de marco, dependência quebrada, frente parada e aprovação envelhecida. A detecção é **regra em código** (PRD §5.7); o agente explica em uma frase e sugere uma ação.
- **Tipo / runtime**: A. A parte determinística roda no job `health-rollup` do Hub; a explicação roda na skill `vigia-de-prazos` do Kratos (D6) ou no Concierge.
- **Gatilhos**: cron após cada rollup (a cada 5 min a regra; a explicação só quando a cor muda).
- **Saídas**: eventos `project.health_changed`, alertas no inbox e no Telegram, lista de riscos na tela Hoje.
- **Ferramentas MCP**: `hub_get_project`, `hub_list_tasks`, `hub_comment`.
- **Escopos**: `projects:read`, `tasks:read`, `comments:write`.
- **Red lines**: não muda a cor da saúde; não altera datas; não cria tarefas.
- **Fase**: M5.

### EX-06 · Executor de Desenvolvimento

- **Missão**: implementar tarefas técnicas nos repositórios dos projetos (e no próprio Hub), com testes e evidência, seguindo o `AGENTS.md` de cada projeto.
- **Tipo / runtime**: B, sessão de Claude Code ou Codex aberta por humano (ou agendada); MCP do Hub registrado no repo; CLI `hub`.
- **Gatilhos**: humano abre a sessão e diz "pega a próxima do Hub" ou `hub_get_today`.
- **Ciclo**: `hub plan pull` → `hub_start_task` → trabalho → `hub_comment` (decisões técnicas) → `hub_complete_task` com SHA/URL/teste → `hub plan push`.
- **Ferramentas MCP**: `hub_whoami`, `hub_get_today`, `hub_list_tasks`, `hub_get_task`, `hub_start_task`, `hub_block_task`, `hub_complete_task`, `hub_create_task`, `hub_comment`, `hub_log_time`, `hub_sync_plan`.
- **Escopos**: `projects:read`, `tasks:read`, `tasks:write`, `tasks:complete`, `comments:write`, `time:write`, `sync:plan`. Projetos: só o do repositório onde a sessão está.
- **Red lines**: uma tarefa em andamento por vez; nunca GATE; nunca `*_client`; nunca segredos em comentários.
- **Fase**: M4 (primeiro com o próprio Hub).

### EX-07 · Executor de Design · EX-08 · Executor de Marketing e Conteúdo · EX-09 · Executor de Dados

Mesmo contrato do EX-06, com departamento e tipo de evidência próprios:
- **Design**: evidência = arquivo/URL do artefato (Figma, PNG, PDF no Storage), checklist de identidade Harmony ou do cliente.
- **Marketing e Conteúdo**: evidência = peça aprovada (copy, roteiro, criativo), métrica registrada ou link publicado **após aprovação humana** (publicar é ação externa → `approvals`).
- **Dados**: evidência = consulta, relatório ou dashboard com fonte; nunca dados pessoais em comentários.
- **Fase**: M4 (design, marketing), M7 (dados).

### CO-10 · Concierge do Hub

- **Missão**: ser a interface em linguagem natural (texto e **voz**) do Hub: "cria uma tarefa de ajustar o hero no site do Leonardo para sexta", "o que está travado no projeto Certato?", "aprova o status da ACM". Converte em ações estruturadas, **mostra a prévia e só executa após confirmação**.
- **Tipo / runtime**: C, dentro do app (barra `⌘K`). Modelo configurável na tela Agentes (D5); sugestão inicial: Claude `claude-sonnet-5-5` para interpretação e `claude-haiku-5-5` para classificação de intenção. Ditado por Web Speech API com transcrição opcional no servidor.
- **Entradas**: fala/texto do usuário, contexto da tela (projeto aberto), permissões do usuário logado (o Concierge age **em nome do humano**, com os limites do humano, e registra `source = ui`, `via = concierge`).
- **Saídas**: ação estruturada (criar/atualizar tarefa, comentar, abrir aprovação, navegar, responder pergunta com dados).
- **Red lines**: nunca executa sem confirmação explícita; nunca decide aprovação sozinho (a decisão continua sendo um clique do humano na prévia); nunca inventa dados em respostas: responde com o que o Hub tem ou diz que não há.
- **Métricas**: ações confirmadas sem edição ≥ 80%; tempo médio de criação de tarefa por voz < 15 s.
- **Fase**: M5.

### PL-11 · Planejador

- **Missão**: a partir de um PRD, brief, transcrição de reunião ou template, propor a estrutura do projeto (marcos com datas sugeridas, frentes por departamento, tarefas iniciais, textos para cliente dos marcos) como **rascunho** para aprovação do Fábio.
- **Tipo / runtime**: C, dentro do app, modelo configurável (D5; sugestão inicial `claude-sonnet-5-5`), com templates do workspace como base.
- **Gatilhos**: "Criar projeto a partir de documento"; "Replanejar a partir de…" (gera proposta para GP-01 levar à aprovação).
- **Saídas**: proposta em formato de árvore editável; ao aprovar, cria marcos, frentes e tarefas e gera o `PLAN.md` inicial do repositório via `hub_sync_plan`.
- **Red lines**: nunca cria nada sem aprovação; datas são sugestões marcadas como tal; não promete prazos ao cliente.
- **Fase**: M5.

### RC-12 · Redator do Cliente

- **Missão**: escrever e revisar tudo o que o cliente lê: `title_client` e `description_client` de marcos e frentes, relatórios de status para cliente, mensagens do portal. Tom Harmony: segunda pessoa, resultado, sem jargão interno, sem nomes de ferramentas, sem valores, sem nomes de outros clientes.
- **Tipo / runtime**: C, dentro do app, modelo configurável (D5; sugestão inicial `claude-sonnet-5-5`).
- **Gatilhos**: promoção de frente a `client`; rascunho de status `audience = client` do RL-03; criação de marco.
- **Saídas**: textos propostos que viram `approval` (`client_visibility` ou `status_report`); verificação de vazamento (lista de termos internos, códigos `HUB-n`, nomes de agentes, SHAs) antes de propor.
- **Red lines**: nunca grava em `*_client` sem aprovação; nunca inclui item operacional; nunca cita ferramenta interna ou agente.
- **Métricas**: zero vazamento em revisão; "Aprovar sem ajuste" ≥ 70%.
- **Fase**: M6.

### OB-13 · Onboarding de Cliente

- **Missão**: quando um cliente é criado ou o portal é habilitado, preparar o acesso: contatos, rascunho do convite, que só sai quando o Fábio liberar o acesso (D9), textos iniciais do portal (objetivo do projeto para cliente), primeira mensagem de boas-vindas (rascunho), checklist de LGPD (consentimento).
- **Tipo / runtime**: C (app) com passos determinísticos; redação via RC-12.
- **Red lines**: nenhum convite ou e-mail sai sem o Fábio clicar em "Liberar acesso" (D9); o OB-13 prepara contatos e textos, nunca libera acesso nem envia.
- **Fase**: M6.

### AC-14 · Auditor de Acesso e Segurança

- **Missão**: revisar semanalmente chaves de agente (uso, expiração, escopo excessivo), membros sem atividade, aprovações antigas, falhas de autorização recorrentes, custos de IA por agente; propor revogações e ajustes.
- **Tipo / runtime**: A (regras no Hub + resumo no Hermes).
- **Saídas**: relatório semanal no inbox do Fábio com ações sugeridas (revogar chave X, reduzir escopo Y); pedidos `agent_key` quando exigir decisão.
- **Red lines**: não revoga nem altera sozinho (exceto chaves expiradas, que o Hub bloqueia por regra).
- **Fase**: M8.

### TO-15 · Controlador de Tempo e Orçamento

- **Missão**: consolidar tempo registrado por agente/pessoa e custo de IA por projeto; comparar com estimativas; sinalizar desvios para o Gestor.
- **Tipo / runtime**: A, Hermes, com dados de `time_entries`, `agent_runs` e estimativas.
- **Red lines**: informativo; não altera orçamento, não fatura.
- **Fase**: M7.

### GH-16 · GitHub Sync

- **Missão**: ligar commits e PRs às tarefas (`HUB-n` na mensagem), comentar com link e SHA, propor conclusão quando houver `fecha HUB-n` (confirmada pelo QA-04 ou humano), registrar `plan_sync_runs` quando a Action de sincronização rodar.
- **Tipo / runtime**: D, webhook do GitHub → `/api/internal/webhooks/github` com segredo.
- **Escopos**: `tasks:read`, `comments:write`, `sync:plan`.
- **Fase**: M4.

### N8-17 · n8n Bridge

- **Missão**: permitir que fluxos já existentes na VPS criem tarefas e comentários (ex.: lead qualificado → tarefa em Marketing e Vendas; chamado de cliente no WhatsApp → tarefa em Sucesso do Cliente) e recebam webhooks do Hub.
- **Tipo / runtime**: D, chave de agente com escopo mínimo por fluxo.
- **Escopos**: `tasks:write`, `comments:write` (por projeto).
- **Fase**: M7.

### KR-00 · Kratos (agente pessoal do Fábio, já existente no Hermes)

- **Papel no Hub (D6, fase 1)**: além de ler e informar ("como está o projeto X?", "o que preciso aprovar hoje?", notificações do Hub no Telegram, links do Hoje), o Kratos **executa os papéis GP-01 a VP-05** como skills (`gestor-de-projetos`, `coordenador-tatico`, `relator-de-status`, `guardiao-da-qualidade`, `vigia-de-prazos`) e é o **importador dos projetos** (D10), seguindo a orientação do Fábio.
- **Escopos**: união dos escopos de gestão (`projects:read`, `milestones:read`, `tasks:read`, `tasks:write`, `tasks:complete` só para reabrir e confirmar, `workstreams:write`, `comments:write`, `approvals:request`, `reports:draft`, `sync:plan`, `agents:read`) e `projects:import`. Nunca `approvals:decide`, `portal:*` ou `agents:keys`.
- **Rastreabilidade**: toda escrita do Kratos informa o `papel` (gestor, coordenador, relator, guardiao, vigia, importador), gravado no `activity_log`; o Console mostra, por exemplo, "Kratos como Coordenador Tático".
- **Limites**: o Kratos roda na VPS e não enxerga as pastas do Mac; projetos que só existem localmente são importados por uma sessão do Claude Code com a mesma ferramenta. Mudanças no `SOUL.md` dele para assumir os papéis passam pela aprovação do Fábio.
- **Separação futura**: se o Fábio criar um agente dedicado, ele recebe uma chave própria com os escopos de gestão, e a chave do Kratos volta a ser só de leitura.
- **Fase**: M5.

---

## 4. Matriz de permissões (escopos por agente)

| Agente | projects:read | tasks:read | tasks:write | tasks:complete | workstreams:write | comments:write | approvals:request | reports:draft | time:write | sync:plan |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| GP-01 Gestor | ● | ● | | | | ● | ● | ● | | |
| CT-02 Coordenador | ● | ● | ● | | ● | ● | ● | | | |
| RL-03 Relator | ● | ● | | | | ● | ● | ● | | |
| QA-04 Guardião | ● | ● | ● (reabrir) | ● (confirmar GitHub) | | ● | ● | | | ● |
| VP-05 Vigia | ● | ● | | | | ● | | | | |
| EX-06..09 Executores | ● | ● | ● | ● | | ● | | | ● | ● |
| CO-10 Concierge | age em nome do humano logado, com os limites do humano | | | | | | | | | |
| PL-11 Planejador | ● | ● | ● (após aprovação) | | ● (após aprovação) | | ● | | | ● |
| RC-12 Redator | ● | | | | | | ● | ● | | |
| OB-13 Onboarding | ● | | | | | | ● | | | |
| AC-14 Auditor | ● | | | | | ● | ● | | | |
| TO-15 Tempo/Orçamento | ● | ● | | | | ● | | | | |
| GH-16 GitHub Sync | | ● | | | | ● | | | | ● |
| N8-17 n8n Bridge | | | ● | | | ● | | | | |
| KR-00 Kratos (fase 1, D6) | ● | ● | ● | ● (reabrir e confirmar) | ● | ● | ● | ● | | ● |

Na fase 1 (D6 e D10), o Kratos também recebe `projects:import`, para cadastrar clientes e projetos e importar `plan.md` em revisão.

`approvals:decide`, `portal:*` e `agents:keys` **nunca** são concedidos a agentes.

---

## 5. Fluxos de ponta a ponta

### 5.1 Novo projeto a partir de um PRD
1. Fábio cria o cliente e o projeto (ou dita para o Concierge).
2. Cola o PRD/brief → **PL-11** propõe marcos, frentes, tarefas e textos para cliente (rascunho).
3. Fábio aprova (ou ajusta) → estrutura criada; `PLAN.md` inicial gerado e commitado no repositório do projeto pelo EX-06 (`hub plan pull`).
4. **OB-13** prepara o portal; **RC-12** redige o objetivo para cliente; o acesso do cliente só é liberado quando o Fábio decidir (D9).

### 5.2 Dia típico
1. 7h30 rollup e regra de saúde (**VP-05**).
2. 8h **CT-02** publica a fila do dia (Telegram + inbox) e cobra bloqueios.
3. Sessões de **EX-06..09** executam: `start` → trabalho → `complete` com evidência → `plan push`.
4. **QA-04** verifica conclusões; reabre o que não tem prova.
5. Fábio abre o **Hoje**: aprova, ajusta ou recusa o que chegou. O **Concierge** executa o que ele ditar.
6. **GP-01** fecha o dia com resumo executivo (só o que mudou).

### 5.3 Semana: status para o cliente
1. Sexta 9h **RL-03** gera rascunho `audience = client` a partir dos dados.
2. **RC-12** reescreve no tom Harmony e roda a verificação de vazamento.
3. Vira `approval` para o Fábio. Aprovou → publicado no portal; se o projeto permitir, e-mail via Resend.
4. Cliente comenta no canal do portal; comentário entra no inbox do Fábio e do GP-01.

### 5.4 Conclusão de tarefa por agente de código
`hub_start_task(HUB-57)` → commit `Adiciona rollup por marco (HUB-57)` → **GH-16** comenta com o SHA → `hub_complete_task(HUB-57, evidence = sha)` → **QA-04** valida (teste verde no CI linkado) → rollup atualiza frente e marco → quadro atualiza em tempo real.

### 5.5 Aceite de marco
1. Todas as frentes do marco `done` → **GP-01** pede `milestone_acceptance` com os critérios conferidos.
2. Fábio aceita (ou devolve com ajuste). `milestones.status = accepted`.
3. Portal mostra o marco como entregue; se o projeto tiver `client_can_confirm_receipt`, o cliente **confirma recebimento** (D9).
4. **RL-03** inclui no próximo status.

### 5.6 Importação dos projetos existentes (D10)
1. O Fábio orienta o Kratos sobre como quer os projetos estruturados: clientes, departamentos, o que vira marco e o que vira frente.
2. Para cada projeto, o Kratos lê `AGENTS.md`, `PRD.md` e `PLAN.md` no GitHub e usa `hub_create_client`, `hub_create_project` e `hub_import_plan`. Projetos que só existem no Mac são importados por uma sessão do Claude Code, com as mesmas ferramentas.
3. Cada projeto entra "Em revisão" com um resumo: marcos, frentes, tarefas, GATEs preservados e o que ficou de fora.
4. O Fábio aprova em lote no Hoje. A partir daí, o projeto sincroniza com o `plan.md` do repositório.

---

## 6. Comunicação e canais

| Canal | Uso | Quem |
|---|---|---|
| Inbox do Hub | Tudo (menções, atribuições, aprovações, alertas) | Todos os humanos |
| Telegram (via Hermes) | Digest matinal, alertas de saúde, resumo executivo, respostas do Kratos | Fábio (e equipe, se configurado) |
| E-mail (Resend) | Convites, relatórios aprovados, confirmações do portal | Clientes e equipe |
| Portal do cliente | Marcos, frentes `client`, relatórios, comentários, arquivos | Clientes |
| WhatsApp | Não na v1 (fica no fluxo humano atual ou em n8n fora do Hub) | — |

---

## 7. Governança

- **Quem cria agentes e chaves**: `owner` (Fábio). Cada chave nasce com expiração (padrão 180 dias) e escopo mínimo.
- **Pausa e revogação**: botão no Console; efeito imediato (`423 Locked` nas chamadas).
- **Orçamento de IA**: por agente interno (`agents.budget_usd_month`) e teto global do workspace (D5). Relatório semanal do AC-14 e do TO-15.
- **Modelo de IA (D5)**: provedor (Anthropic, OpenAI ou xAI), modelo e chave de cada agente interno são trocados pelo Fábio na tela Agentes, sem deploy. As chaves ficam cifradas e aparecem só com os 4 últimos caracteres.
- **Prompts base dos agentes**: versionados em `agents/hermes/` (autônomos) e `app/src/modules/agents/prompts/` (internos), sem segredos, com changelog.
- **Avaliação**: amostragem mensal de 20 ações por agente (QA-04 + Fábio): fato inventado = incidente; ajuste de prompt registrado.
- **Red line final**: nenhum agente envia mensagem a cliente, publica, aceita marco, muda escopo ou altera infraestrutura. Isso é humano, registrado em `approvals`.

---

## 8. Ordem de implantação

| Fase | Agentes | Pré-requisito |
|---|---|---|
| M1 | Agente de teste (`hub_test`) para validar MCP/REST | Núcleo do Hub |
| M4 | EX-06 (no próprio Hub), GH-16, depois EX-07/EX-08 nos projetos importados | CLI e sync do `plan.md` |
| M5 | KR-00 executando GP-01, CT-02, RL-03 (interno), QA-04 e VP-05 (D6); importação de todos os projetos (D10); CO-10 e PL-11 com IA multi-provedor (D5) | Skills de gestão no Kratos, Console de agentes, tela "Modelo de IA" |
| M6 | RC-12, OB-13, RL-03 (cliente) | Portal do cliente, Resend |
| M7 | EX-09, TO-15, N8-17 | Tempo, departamentos, visões avançadas |
| M8 | AC-14 | Backups, observabilidade |
| M9 | Pacote de agentes replicável por workspace | Produto |
