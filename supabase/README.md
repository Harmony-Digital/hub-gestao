# Banco · schema `proj_hub_gestao`

- **Instância:** Supabase self-hosted compartilhado da Harmony, na VPS KVM4 (decisão D2).
- **Situação:** registrado em 2026-10-09 com `harmony_admin.create_project('hub_gestao', 'Hub de Gestão', 'Harmony Digital')`. Schema `proj_hub_gestao` criado, ainda sem tabelas.
- **Acesso dos agentes de código:** MCP `harmony-supabase`, que sobe por um túnel SSH local na porta 8080 (LaunchAgent `com.harmonydigital.supabase-mcp-tunnel`, via Tailscale).
- **O que o registro faz:** `create_project` cria o schema se ele não existir, dá `USAGE` e privilégios padrão ao `service_role` e leitura ao `supabase_read_only_user`, e grava o projeto no catálogo. Não expõe o schema no PostgREST nem dá acesso a `anon` ou `authenticated`.
- **Registro do projeto:** sempre por `harmony_admin.create_project(...)`, nunca criando o schema à mão. Resolver o schema pelo catálogo `harmony_admin.projects` com o slug `hub_gestao`. O catálogo aceita só minúsculas, números e sublinhado, por isso o slug difere do nome do repositório.

## Migrations

- Arquivos em `supabase/migrations/hub_gestao_NNNN_descricao.sql`, aplicados com `apply_migration` e nome prefixado `hub_gestao_`.
- Nunca usar `execute_sql` para DDL.
- Depois de cada migration: advisors de segurança e desempenho, com os achados registrados no `PLAN.md`.
- Toda tabela da aplicação nasce com RLS ligada e políticas mínimas.

## Testes

`supabase/tests/` guarda os testes SQL de RLS: dois workspaces e o papel de cliente, que nunca lê tarefas nem comentários internos.

## Nunca

- Tocar outros schemas `proj_*`, schemas globais ou as instâncias `supabase-relgov` e `supabase-leonardo`.
- Rodar operação destrutiva sem confirmação específica do Fábio.
