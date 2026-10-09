-- Hub de Gestão · seed do workspace da Harmony
-- Idempotente: pode rodar de novo sem duplicar nem alterar o que já existe.
-- Roda como administrador do banco (MCP harmony-supabase, execute_sql), uma vez por ambiente.
--
-- Origem de cada dado (nada inventado):
--   dono do produto ........ cabeçalho do PRD (Fábio Almeida, contato@harmonydigital.com.br)
--   departamentos .......... PRD §6, com as cores do protótipo aprovado em 2026-10-09
--   status padrão .......... PRD RF-15 (A fazer, Em andamento, Em revisão, Bloqueada, Concluída)
--   cliente interno ........ PRD §6, "Harmony Digital (interno)"
--   projeto HUB ............ este projeto: repositório, PLAN.md e início da preparação (2026-10-08)
--   teto de IA ............. decisão D5 (US$ 30/mês somados, editável na tela Agentes)
-- Líderes de departamento, departamentos do projeto e fase ficam para o Fábio definir.

do $$
declare
  v_ws uuid;
  v_owner uuid;
  v_client uuid;
  v_project uuid;
begin
  insert into proj_hub_gestao.workspaces (slug, name, task_prefix, branding, timezone, locale, settings)
  values (
    'harmony',
    'Harmony Digital',
    'HUB',
    jsonb_build_object(
      'colors', jsonb_build_object('navy', '#151A2D', 'off_white', '#FAF8F4', 'brand', '#F28C1D'),
      'fonts', jsonb_build_object('heading', 'Sora', 'body', 'DM Sans', 'mono', 'JetBrains Mono'),
      'logo', jsonb_build_object(
        'on_light', '/brand/harmony-logo-escuro.png',
        'on_dark', '/brand/harmony-logo-branco.png',
        'symbol', '/brand/harmony-simbolo.png'
      )
    ),
    'America/Sao_Paulo',
    'pt-BR',
    jsonb_build_object(
      'default_task_statuses', jsonb_build_array(
        jsonb_build_object('name', 'A fazer', 'category', 'todo', 'color', '#8E93A3', 'sort_order', 1, 'is_default', true),
        jsonb_build_object('name', 'Em andamento', 'category', 'in_progress', 'color', '#3B6FB6', 'sort_order', 2, 'is_default', false),
        jsonb_build_object('name', 'Em revisão', 'category', 'review', 'color', '#7E5CC4', 'sort_order', 3, 'is_default', false),
        jsonb_build_object('name', 'Bloqueada', 'category', 'blocked', 'color', '#C8463C', 'sort_order', 4, 'is_default', false),
        jsonb_build_object('name', 'Concluída', 'category', 'done', 'color', '#2F8F5B', 'sort_order', 5, 'is_default', false)
      ),
      'ai_budget_usd_month_total', 30,
      'require_evidence_default', true
    )
  )
  on conflict (slug) do nothing;
  select id into strict v_ws from proj_hub_gestao.workspaces where slug = 'harmony';

  select id into v_owner
    from proj_hub_gestao.profiles
   where lower(email) = 'contato@harmonydigital.com.br' and deactivated_at is null;
  if v_owner is null then
    insert into proj_hub_gestao.profiles (email, full_name)
    values ('contato@harmonydigital.com.br', 'Fábio Almeida')
    returning id into v_owner;
  end if;

  insert into proj_hub_gestao.memberships (workspace_id, profile_id, role)
  values (v_ws, v_owner, 'owner')
  on conflict (workspace_id, profile_id) do nothing;

  insert into proj_hub_gestao.departments (workspace_id, slug, name, color, sort_order)
  values
    (v_ws, 'estrategia', 'Estratégia', '#3B4A8C', 1),
    (v_ws, 'marketing-e-vendas', 'Marketing e Vendas', '#C2410C', 2),
    (v_ws, 'agentes-e-automacoes', 'Agentes e Automações', '#0F766E', 3),
    (v_ws, 'sistemas', 'Sistemas', '#1D4ED8', 4),
    (v_ws, 'design', 'Design', '#A21CAF', 5),
    (v_ws, 'dados', 'Dados', '#4D7C0F', 6),
    (v_ws, 'gestao', 'Gestão', '#151A2D', 7),
    (v_ws, 'administrativo-e-financeiro', 'Administrativo e Financeiro', '#6B7280', 8),
    (v_ws, 'sucesso-do-cliente', 'Sucesso do Cliente', '#B45309', 9)
  on conflict (workspace_id, slug) do nothing;

  insert into proj_hub_gestao.clients (workspace_id, slug, name, notes_internal)
  values (
    v_ws,
    'harmony-digital',
    'Harmony Digital (interno)',
    'Cliente especial dos projetos internos da Harmony, como o próprio Hub e o site (PRD §6).'
  )
  on conflict (workspace_id, slug) do nothing;
  select id into strict v_client
    from proj_hub_gestao.clients where workspace_id = v_ws and slug = 'harmony-digital';

  insert into proj_hub_gestao.projects (
    workspace_id, client_id, code, name, objective_internal, status, start_date,
    owner_profile_id, repo_url, plan_path
  )
  values (
    v_ws,
    v_client,
    'HUB',
    'Hub de Gestão',
    'Sistema de gestão de projetos, departamentos e atividades em que agentes de IA trabalham como operadores de primeira classe, por API REST e MCP, e pessoas acompanham, decidem e aprovam pela interface.',
    'active',
    date '2026-10-08',
    v_owner,
    'https://github.com/Harmony-Digital/hub-gestao',
    'PLAN.md'
  )
  on conflict (workspace_id, code) do nothing;
  select id into strict v_project
    from proj_hub_gestao.projects where workspace_id = v_ws and code = 'HUB';

  insert into proj_hub_gestao.project_members (workspace_id, project_id, profile_id, role)
  values (v_ws, v_project, v_owner, 'lead')
  on conflict (project_id, profile_id) do nothing;

  -- Status do projeto copiados do padrão do workspace (configuração, não código).
  insert into proj_hub_gestao.task_statuses (workspace_id, project_id, name, color, category, sort_order, is_default)
  select v_ws, v_project, s ->> 'name', s ->> 'color',
         (s ->> 'category')::proj_hub_gestao.status_category,
         (s ->> 'sort_order')::int, (s ->> 'is_default')::boolean
    from proj_hub_gestao.workspaces w,
         jsonb_array_elements(w.settings -> 'default_task_statuses') s
   where w.id = v_ws
  on conflict (project_id, name) do nothing;
end
$$;
