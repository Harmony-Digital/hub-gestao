# Hub de Gestão · Harmony Digital

Sistema de gestão de projetos, departamentos e atividades em que agentes de IA trabalham por API e MCP, e pessoas acompanham, decidem e aprovam. Uso interno da Harmony Digital.

**A IA executa. O humano decide.**

[![Qualidade](https://github.com/Harmony-Digital/hub-gestao/actions/workflows/ci.yml/badge.svg)](https://github.com/Harmony-Digital/hub-gestao/actions/workflows/ci.yml)

## Comece por aqui

1. [`AGENTS.md`](AGENTS.md): instruções canônicas para qualquer IA ou pessoa que trabalhe neste repositório.
2. [`PRD.md`](PRD.md): produto, requisitos, arquitetura e stack.
3. [`AGENTES.md`](AGENTES.md): os agentes do sistema e o que cada um pode fazer.
4. [`PLAN.md`](PLAN.md): estado vivo do projeto, em checklist por etapa.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `app/` | Aplicação Next.js 16: interface, API REST v1 para agentes (`/api/v1`) e servidor MCP (`/mcp`) |
| `supabase/` | Migrations e seed do schema `proj_hub_gestao` |
| `docs/` | Credenciais, guia de conexão dos agentes e os contratos da API e do MCP |
| `.github/workflows/` | Integração contínua |

## Para agentes

- [`docs/agentes-conexao.md`](docs/agentes-conexao.md): como conectar Claude Code, Codex e Kratos por MCP ou REST.
- [`docs/api/openapi.v1.json`](docs/api/openapi.v1.json): contrato da API REST v1 (OpenAPI 3.1).
- [`docs/mcp/tools.v1.json`](docs/mcp/tools.v1.json): ferramentas do servidor MCP.

## Rodar localmente

```bash
cd app
npm ci
npm run dev
```

Abra http://localhost:3000. Sem `DATABASE_URL`, o servidor usa um banco local (PGlite) com as migrations e o seed da Harmony. Antes de concluir qualquer tarefa, rode `npm run check` dentro de `app/`.
