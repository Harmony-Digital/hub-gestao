# Como um agente se conecta ao Hub

Guia prático para Claude Code, Codex, Kratos (Hermes) e integrações. As regras de comportamento estão no `AGENTS.md`, Parte B (Protocolo do Agente Operador). O contrato completo está em `docs/api/openapi.v1.json` (REST) e `docs/mcp/tools.v1.json` (MCP); os dois são conferidos por teste a cada mudança.

## 1. A chave

- Formato: `hub_ak_<prefixo>.<segredo>`. O Fábio cria na tela Agentes (M3) e o valor aparece uma única vez. No banco fica só o hash.
- Cada chave tem **escopos** e **projetos**. Sem o escopo, a ação volta 403 dizendo qual escopo falta. Fora dos projetos da chave, também 403.
- Nenhuma chave de agente recebe `approvals:decide`, `portal:*` ou `agents:keys`. Decidir é sempre de uma pessoa.
- Agente pausado pelo Fábio recebe 423 em qualquer chamada. Chave vencida ou revogada recebe 401.

| Escopo | Permite |
|---|---|
| `projects:read` | Projetos, plano, frentes, comentários, aprovações e relatórios |
| `milestones:read` | Marcos |
| `tasks:read` | Tarefas |
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

Codex e Hermes: mesmo endereço e mesmo cabeçalho. Confirmar o formato de configuração de servidor MCP por HTTP na versão instalada de cada um; se não houver suporte, usar a API REST abaixo.

O servidor mostra só as ferramentas que a chave pode usar. A primeira chamada é sempre `hub_whoami`.

| Ferramenta | Para quê |
|---|---|
| `hub_whoami` | Identidade, workspace, projetos, escopos e orçamento |
| `hub_get_today` | Minha fila: tarefas, bloqueios, prazos e pedidos |
| `hub_list_projects`, `hub_get_project`, `hub_get_plan` | Projetos e o plano (JSON ou `plan.md`) |
| `hub_list_tasks`, `hub_get_task` | Tarefas com filtros; detalhe com comentários |
| `hub_create_task`, `hub_update_task` | Criar e editar tarefa |
| `hub_start_task`, `hub_block_task`, `hub_complete_task`, `hub_reopen_task` | Transições; concluir exige evidência |
| `hub_comment` | Comentário interno em tarefa, frente, marco ou projeto |
| `hub_create_workstream`, `hub_update_workstream` | Frentes |
| `hub_request_approval`, `hub_list_approvals` | Pedir decisão e acompanhar |
| `hub_draft_status_report` | Rascunho de status, que vira pedido de aprovação |
| `hub_log_time`, `hub_search`, `hub_sync_plan` | Tempo, busca e exportação do `plan.md` |

Recursos: `hub://projects/{code}/plan.md`, `hub://projects/{code}/health` e `hub://today`. Prompts: `status-semanal`, `digest-matinal` e `revisar-conclusoes`.

Em escritas, envie `idempotency_key` (um valor novo por ação) para poder repetir com segurança, e `papel` (ex.: `GP-01`) quando o agente acumula papéis, como o Kratos (D6).

## 3. API REST

Base: `https://hub.harmonydigital.com.br/api/v1`. Contrato em `/api/v1/openapi.json`.

| Cabeçalho | Quando |
|---|---|
| `Authorization: Bearer <chave>` | Sempre |
| `Idempotency-Key` | Toda escrita (POST e PATCH). Mesma chave e mesmo corpo devolvem a mesma resposta (`Idempotent-Replayed: true`); corpo diferente, 409 |
| `Hub-Acting-Role` | Opcional: papel do catálogo nesta escrita |
| `If-Match` | Opcional no PATCH de tarefa: use o `ETag` da leitura; se a tarefa mudou, 412 |

Erros vêm em `application/problem+json`, com `detail` em português dizendo o que corrigir e, quando for o caso, `errors` (campos), `missing_scope` ou `human_only`. Listas paginam por `cursor` e `limit` (até 200).

```bash
curl -s https://hub.harmonydigital.com.br/api/v1/me -H "Authorization: Bearer $HUB_API_KEY"
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
