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
| `app/` | Aplicação Next.js 16: interface, API para agentes e, a partir do M1, servidor MCP |
| `supabase/` | Migrations e testes do schema `proj_hub_gestao` |
| `docs/` | Credenciais, operação e decisões técnicas |
| `.github/workflows/` | Integração contínua |

## Rodar localmente

```bash
cd app
npm ci
npm run dev
```

Abra http://localhost:3000. Antes de concluir qualquer tarefa, rode `npm run check` dentro de `app/`.
