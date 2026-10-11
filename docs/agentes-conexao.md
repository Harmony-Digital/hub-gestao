# Como um agente se conecta ao Hub

Guia prático para Claude Code, Codex, Kratos (Hermes) e integrações. As regras de comportamento estão no `AGENTS.md`, Parte B (Protocolo do Agente Operador). O contrato completo está em `docs/api/openapi.v1.json` (REST) e `docs/mcp/tools.v1.json` (MCP); os dois são conferidos por teste a cada mudança.

## 1. A chave

- Formato: `hub_ak_<prefixo>.<segredo>`. O Fábio cria na tela Agentes (M3) e o valor aparece uma única vez. No banco fica só o hash.
- Cada chave tem **escopos** e **projetos**. Sem o escopo, a ação volta 403 dizendo qual escopo falta. Fora dos projetos da chave, também 403.
- Nenhuma chave de agente recebe `approvals:decide`, `portal:*` ou `agents:keys`. Decidir é sempre de uma pessoa.
- Agente pausado pelo Fábio recebe 423 em qualquer chamada. Chave vencida ou revogada recebe 401.

| Escopo | Permite |
|---|---|
| `projects:read` | Projetos, plano, frentes, comentários de projeto, marco e frente, aprovações e relatórios |
| `milestones:read` | Marcos |
| `tasks:read` | Tarefas e os comentários delas |
| `tasks:write` | Criar e editar tarefas |
| `tasks:complete` | Iniciar, bloquear, concluir com evidência e reabrir |
| `workstreams:write` | Criar e editar frentes (sempre internas) |
| `comments:write` | Comentar (sempre interno) |
| `approvals:request` | Pedir decisão ao Fábio |
| `reports:draft` | Rascunho de relatório de status |
| `time:write` | Registrar tempo |
| `sync:plan` | Exportar o `plan.md` (importação no M4) |
| `projects:import` | Cadastrar clientes e projetos importados (M5) |
| `workspace:*` | Todos os projetos do workspace, só quando o Fábio autorizar |

## 2. MCP (recomendado)

Endereço: `https://hub.harmonydigital.com.br/mcp` (no ar a partir do M2). Transporte Streamable HTTP, sem estado, com a chave no cabeçalho `Authorization: Bearer`.

Claude Code, no `.mcp.json` do repositório do projeto, com a chave numa variável de ambiente (nunca no arquivo):

```json
{
  "mcpServers": {
    "hub": {
      "type": "http",
      "url": "https://hub.harmonydigital.com.br/mcp",
      "headers": { "Authorization": "Bearer ${HUB_API_KEY}" }
    }
  }
}
```

No Mac do Fábio, o caminho pronto é este:

1. Criar o agente e a chave em `https://hub.harmonydigital.com.br/agentes`. A chave aparece uma única vez.
2. Rodar `bash scripts/conectar-claude-code.sh`. O script pede a chave sem mostrá-la na tela e confere no Hub (`/api/v1/me`). Depois guarda a chave nas Chaves do macOS (serviço `hub-gestao-producao`) e escreve `~/.config/hub-gestao/mcp-producao.json`, sem segredo.
3. Rodar `bash scripts/teste-mcp-producao.sh`. O Claude Code roda só com as ferramentas do Hub e cria, inicia e conclui uma tarefa no projeto HUB, com evidência. É o teste do GATE M2.

Codex e Hermes: mesmo endereço e mesmo cabeçalho. Confirmar o formato de configuração de servidor MCP por HTTP na versão instalada de cada um; se não houver suporte, usar a API REST abaixo.

n8n (N8-17): pela API REST, com o fluxo pronto para importar e o passo a passo em `docs/n8n.md`.

O servidor mostra só as ferramentas que a chave pode usar. A primeira chamada é sempre `hub_whoami`.

| Ferramenta | Para quê |
|---|---|
| `hub_whoami` | Identidade, workspace, projetos, escopos e orçamento |
| `hub_get_today` | Minha fila: tarefas, bloqueios, prazos e pedidos |
| `hub_list_projects`, `hub_get_project`, `hub_get_plan` | Projetos e o plano (JSON ou `plan.md`) |
| `hub_get_milestone` | Um marco pelo código (ex.: VIT e M2), com o histórico de datas e o motivo de cada mudança (interno); também em `GET /api/v1/milestones/{id}` (`date_history`) |
| `hub_list_tasks`, `hub_get_task` | Tarefas com filtros (projeto, responsável, status, prazo, bloqueio, frente, departamento pelo slug, etiqueta e tarefa-pai); detalhe com comentários |
| `hub_create_task`, `hub_update_task` | Criar e editar tarefa (também as etiquetas: `labels`, a lista inteira pelo nome, e, na edição, os campos personalizados do projeto: `custom_fields`, pelo nome do campo) |
| `hub_start_task`, `hub_block_task`, `hub_complete_task`, `hub_reopen_task` | Transições; concluir exige evidência |
| `hub_comment` | Comentário interno em tarefa, frente, marco ou projeto |
| `hub_notify` | Aviso na caixa de entrada do Hub, para os donos ou uma pessoa da equipe (o digest, lembretes, alertas); `dedupe_key` evita repetir em 24 horas; até 30 por dia (`comments:write`; na API, `POST /api/v1/notices`) |
| `hub_create_workstream`, `hub_update_workstream` | Frentes, com as dependências entre elas (`depends_on`: a lista inteira de ids de frentes do mesmo projeto, sem ciclo) |
| `hub_request_approval`, `hub_list_approvals` | Pedir decisão e acompanhar |
| `hub_draft_status_report` | Rascunho de status, que vira pedido de aprovação |
| `hub_log_time`, `hub_search`, `hub_sync_plan` | Tempo, busca e exportação do `plan.md` |
| `hub_get_access_audit` | Auditoria de acesso e segurança (AC-14): os pontos para o dono olhar, com o que fazer; precisa de `agents:read` e acesso a todos os projetos (também em `GET /api/v1/audit/access`) |
| `hub_get_project_time` | Tempo do projeto: por pessoa ou agente e por frente, estimado contra registrado e as tarefas acima da estimativa (o TO-15 lê daqui; também em `GET /api/v1/projects/{code}/time`) |
| `hub_list_custom_fields` | Campos personalizados das tarefas do projeto: nome, tipo (texto, número, seleção, data ou URL) e as opções da seleção (também em `GET /api/v1/projects/{code}/custom-fields`). O valor de cada tarefa vem em `custom_fields` no `hub_get_task` |

Recursos: `hub://projects/{code}/plan.md`, `hub://projects/{code}/health` e `hub://today`. Prompts: `status-semanal`, `digest-matinal` e `revisar-conclusoes`.

Toda ferramenta de escrita exige `idempotency_key`: um valor novo por ação, como um UUID. Repetir a mesma chave com os mesmos dados devolve o mesmo resultado, sem duplicar; a mesma chave com outros dados, ou com outra chave de agente, é recusada. Informe também `papel` (ex.: `GP-01`) quando o agente acumula papéis, como o Kratos (D6).

O servidor aceita uma mensagem JSON-RPC por pedido, com corpo de até 1 MB; lotes de mensagens são recusados, para que nenhum pedido escape do limite de pedidos da chave.

Títulos e nomes têm uma linha só: quebras de linha são recusadas pela API e pelo banco. Texto para o cliente, visibilidade, marcos, chaves e cadastros de pessoas não são escritos por agentes; o banco recusa mesmo que algum caminho do servidor tente.

## 3. API REST

Base: `https://hub.harmonydigital.com.br/api/v1`. Contrato em `/api/v1/openapi.json`.

| Cabeçalho | Quando |
|---|---|
| `Authorization: Bearer <chave>` | Sempre |
| `Idempotency-Key` | Toda escrita (POST e PATCH). Mesma chave e mesmo corpo devolvem a mesma resposta (`Idempotent-Replayed: true`); corpo diferente ou outra chave de agente, 409 |
| `Hub-Acting-Role` | Opcional: papel do catálogo nesta escrita |
| `If-Match` | Opcional no PATCH de tarefa: use o `ETag` da leitura; se a tarefa mudou, 412 |

Erros vêm em `application/problem+json`, com `detail` em português dizendo o que corrigir e, quando for o caso, `errors` (campos), `missing_scope` ou `human_only`. Listas paginam por `cursor` e `limit` (até 200).

```bash
curl -s https://hub.harmonydigital.com.br/api/v1/me -H "Authorization: Bearer $HUB_API_KEY"
```

A atividade de um projeto por período (RF-43), em JSON, para relatório ou análise (escopo `projects:read`; até 366 dias e 50 mil registros):

```bash
curl -s "https://hub.harmonydigital.com.br/api/v1/activity?project=HUB&from=2026-10-01&to=2026-10-31" -H "Authorization: Bearer $HUB_API_KEY"
```

```bash
curl -s https://hub.harmonydigital.com.br/api/v1/tasks/HUB-12/complete \
  -H "Authorization: Bearer $HUB_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"evidence": "commit 3f9a2c1"}'
```

## 4. Desenvolvimento local

Sem `DATABASE_URL`, o servidor de desenvolvimento usa um banco local (PGlite em `app/.data/pglite`) com as mesmas migrations e o seed da Harmony. Com `HUB_DEV_AGENT_KEY` no `app/.env.local`, ele registra o "Agente local de teste", com acesso ao projeto HUB. Endereços locais: `http://localhost:3100/mcp` e `http://localhost:3100/api/v1`.
