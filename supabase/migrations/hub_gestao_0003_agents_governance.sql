-- Hub de Gestão · 0003 · Agentes e governança
-- Agentes com chave própria e escopo, credenciais de IA cifradas (D5), aprovações,
-- relatórios, notificações, webhooks, registro de atividades (append-only) e fila de jobs.

create type proj_hub_gestao.agent_kind as enum ('hermes', 'internal', 'session', 'integration');
create type proj_hub_gestao.agent_status as enum ('active', 'paused', 'revoked');
create type proj_hub_gestao.llm_provider as enum ('anthropic', 'openai', 'xai');
create type proj_hub_gestao.approval_type as enum (
  'status_report', 'milestone_acceptance', 'milestone_proposal', 'replan', 'scope_change',
  'client_visibility', 'external_message', 'agent_key', 'import_review', 'custom'
);
create type proj_hub_gestao.approval_status as enum ('pending', 'approved', 'rejected', 'adjust_requested', 'cancelled');
create type proj_hub_gestao.report_audience as enum ('internal', 'client');
create type proj_hub_gestao.job_status as enum ('queued', 'running', 'done', 'failed');

-- Credenciais de IA: a chave fica cifrada (AES-256-GCM no servidor, com HUB_ENCRYPTION_KEY).
create table proj_hub_gestao.llm_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  provider proj_hub_gestao.llm_provider not null,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  key_ciphertext text not null,
  key_last4 text not null check (char_length(key_last4) = 4),
  created_by_profile_id uuid references proj_hub_gestao.profiles(id) on delete restrict,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table proj_hub_gestao.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  kind proj_hub_gestao.agent_kind not null,
  department_id uuid references proj_hub_gestao.departments(id) on delete set null,
  mission text check (mission is null or char_length(mission) <= 2000),
  roles text[] not null default '{}',
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  llm_provider proj_hub_gestao.llm_provider,
  llm_model text,
  llm_credential_id uuid references proj_hub_gestao.llm_credentials(id) on delete set null,
  status proj_hub_gestao.agent_status not null default 'active',
  budget_usd_month numeric(10, 2) not null default 0 check (budget_usd_month >= 0),
  spent_usd_month numeric(12, 4) not null default 0 check (spent_usd_month >= 0),
  owner_profile_id uuid references proj_hub_gestao.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create trigger agents_touch before update on proj_hub_gestao.agents
  for each row execute function proj_hub_gestao.touch_updated_at();

alter table proj_hub_gestao.projects
  add constraint projects_pm_agent_fk foreign key (pm_agent_id)
  references proj_hub_gestao.agents(id) on delete set null;

-- Chave de agente: só o hash fica guardado; o valor aparece uma vez, na criação.
create table proj_hub_gestao.agent_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  agent_id uuid not null references proj_hub_gestao.agents(id) on delete cascade,
  key_prefix text not null unique check (key_prefix ~ '^hub_ak_[a-z0-9]{8,16}$'),
  key_hash text not null check (char_length(key_hash) = 64),
  scopes text[] not null check (cardinality(scopes) > 0),
  project_ids uuid[],
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by_profile_id uuid references proj_hub_gestao.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Escopos que nenhum agente pode ter.
  constraint agent_api_keys_forbidden_scopes check (
    not (scopes && array['approvals:decide', 'portal:read', 'portal:write', 'agents:keys']::text[])
  )
);
create index agent_api_keys_agent_idx on proj_hub_gestao.agent_api_keys (agent_id);

create table proj_hub_gestao.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  agent_id uuid not null references proj_hub_gestao.agents(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source text not null,
  summary text,
  cost_usd numeric(12, 4) not null default 0 check (cost_usd >= 0),
  error text
);
create index agent_runs_agent_idx on proj_hub_gestao.agent_runs (agent_id, started_at desc);

-- Aprovações: agentes só pedem; quem decide é humano, pela interface.
create table proj_hub_gestao.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  project_id uuid references proj_hub_gestao.projects(id) on delete cascade,
  type proj_hub_gestao.approval_type not null,
  entity_type text check (entity_type is null or entity_type in ('project', 'milestone', 'workstream', 'task', 'report', 'agent', 'client_contact')),
  entity_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  summary text check (summary is null or char_length(summary) <= 4000),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  requested_by_type proj_hub_gestao.actor_type not null,
  requested_by_id uuid,
  acting_role text,
  approver_profile_id uuid references proj_hub_gestao.profiles(id) on delete set null,
  due_at timestamptz,
  status proj_hub_gestao.approval_status not null default 'pending',
  decision_note text check (decision_note is null or char_length(decision_note) <= 4000),
  decided_by_profile_id uuid references proj_hub_gestao.profiles(id) on delete restrict,
  decided_at timestamptz,
  effect jsonb not null default '{}'::jsonb check (jsonb_typeof(effect) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approvals_decision_state check (
    (status = 'pending' and decided_at is null)
    or (status = 'cancelled')
    or (status in ('approved', 'rejected', 'adjust_requested') and decided_at is not null and decided_by_profile_id is not null)
  )
);
create index approvals_pending_idx on proj_hub_gestao.approvals (workspace_id, status, created_at);
create trigger approvals_touch before update on proj_hub_gestao.approvals
  for each row execute function proj_hub_gestao.touch_updated_at();

create table proj_hub_gestao.status_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  audience proj_hub_gestao.report_audience not null,
  body_md text not null check (char_length(btrim(body_md)) between 1 and 20000),
  generated_by_agent_id uuid references proj_hub_gestao.agents(id) on delete set null,
  approval_id uuid references proj_hub_gestao.approvals(id) on delete set null,
  published_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references proj_hub_gestao.projects(workspace_id, id) on delete cascade
);
create index status_reports_project_idx on proj_hub_gestao.status_reports (project_id, period_end desc);

create table proj_hub_gestao.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  profile_id uuid not null references proj_hub_gestao.profiles(id) on delete cascade,
  type text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_inbox_idx on proj_hub_gestao.notifications (profile_id, read_at, created_at desc);

create table proj_hub_gestao.notification_prefs (
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  profile_id uuid not null references proj_hub_gestao.profiles(id) on delete cascade,
  type text not null,
  channel text not null check (channel in ('inbox', 'telegram', 'email')),
  enabled boolean not null default true,
  primary key (profile_id, type, channel)
);

create table proj_hub_gestao.webhooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  url text not null check (url ~ '^https://'),
  events text[] not null check (cardinality(events) > 0),
  secret_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger webhooks_touch before update on proj_hub_gestao.webhooks
  for each row execute function proj_hub_gestao.touch_updated_at();

create table proj_hub_gestao.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  webhook_id uuid not null references proj_hub_gestao.webhooks(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status_code integer,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

-- Registro de atividades: só inserção. Nada é alterado nem apagado depois.
create table proj_hub_gestao.activity_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  actor_type proj_hub_gestao.actor_type not null,
  actor_id uuid,
  acting_role text,
  source text not null check (source in ('ui', 'api', 'mcp', 'sync', 'cron', 'webhook', 'system')),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  project_id uuid,
  before jsonb,
  after jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index activity_log_entity_idx on proj_hub_gestao.activity_log (entity_type, entity_id, created_at desc);
create index activity_log_project_idx on proj_hub_gestao.activity_log (project_id, created_at desc);
create index activity_log_actor_idx on proj_hub_gestao.activity_log (actor_type, actor_id, created_at desc);

create function proj_hub_gestao.activity_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'activity_log é somente inserção'
    using errcode = 'insufficient_privilege';
end;
$$;
create trigger activity_log_no_update before update or delete on proj_hub_gestao.activity_log
  for each row execute function proj_hub_gestao.activity_log_append_only();
create trigger activity_log_no_truncate before truncate on proj_hub_gestao.activity_log
  for each statement execute function proj_hub_gestao.activity_log_append_only();

-- Idempotência: mesma chave e mesmo corpo devolvem a mesma resposta.
create table proj_hub_gestao.idempotency_keys (
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  actor_id uuid not null,
  key text not null check (char_length(key) between 8 and 200),
  request_hash text not null,
  response_status integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  primary key (actor_id, key)
);

create table proj_hub_gestao.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  status proj_hub_gestao.job_status not null default 'queued',
  locked_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_queue_idx on proj_hub_gestao.jobs (status, run_at);
create trigger jobs_touch before update on proj_hub_gestao.jobs
  for each row execute function proj_hub_gestao.touch_updated_at();

create table proj_hub_gestao.plan_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  project_id uuid not null references proj_hub_gestao.projects(id) on delete cascade,
  direction text not null check (direction in ('pull', 'push', 'import')),
  source text not null,
  commit_sha text,
  summary jsonb not null default '{}'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table proj_hub_gestao.saved_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  profile_id uuid not null references proj_hub_gestao.profiles(id) on delete cascade,
  project_id uuid references proj_hub_gestao.projects(id) on delete cascade,
  department_id uuid references proj_hub_gestao.departments(id) on delete cascade,
  type text not null check (type in ('list', 'board', 'timeline', 'calendar', 'table', 'dashboard')),
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table proj_hub_gestao.project_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  name text not null,
  description text,
  structure jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

-- Regras de acesso (RLS): tudo aqui é interno; o cliente só lê relatórios publicados para ele.

alter table proj_hub_gestao.llm_credentials enable row level security;
alter table proj_hub_gestao.agents enable row level security;
alter table proj_hub_gestao.agent_api_keys enable row level security;
alter table proj_hub_gestao.agent_runs enable row level security;
alter table proj_hub_gestao.approvals enable row level security;
alter table proj_hub_gestao.status_reports enable row level security;
alter table proj_hub_gestao.notifications enable row level security;
alter table proj_hub_gestao.notification_prefs enable row level security;
alter table proj_hub_gestao.webhooks enable row level security;
alter table proj_hub_gestao.webhook_deliveries enable row level security;
alter table proj_hub_gestao.activity_log enable row level security;
alter table proj_hub_gestao.idempotency_keys enable row level security;
alter table proj_hub_gestao.jobs enable row level security;
alter table proj_hub_gestao.plan_sync_runs enable row level security;
alter table proj_hub_gestao.saved_views enable row level security;
alter table proj_hub_gestao.project_templates enable row level security;

create policy llm_credentials_internal on proj_hub_gestao.llm_credentials for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy agents_internal on proj_hub_gestao.agents for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy agent_api_keys_internal on proj_hub_gestao.agent_api_keys for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy agent_runs_internal on proj_hub_gestao.agent_runs for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy approvals_internal on proj_hub_gestao.approvals for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy status_reports_internal on proj_hub_gestao.status_reports for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy status_reports_client_read on proj_hub_gestao.status_reports for select
  using (audience = 'client' and published_at is not null and proj_hub_gestao.project_visible_to_client(project_id));
create policy notifications_internal on proj_hub_gestao.notifications for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy notification_prefs_internal on proj_hub_gestao.notification_prefs for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy webhooks_internal on proj_hub_gestao.webhooks for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy webhook_deliveries_internal on proj_hub_gestao.webhook_deliveries for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy activity_log_internal_read on proj_hub_gestao.activity_log for select
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy activity_log_internal_insert on proj_hub_gestao.activity_log for insert
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy idempotency_keys_internal on proj_hub_gestao.idempotency_keys for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy jobs_internal on proj_hub_gestao.jobs for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy plan_sync_runs_internal on proj_hub_gestao.plan_sync_runs for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy saved_views_internal on proj_hub_gestao.saved_views for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy project_templates_internal on proj_hub_gestao.project_templates for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());

-- Consultas de autenticação --------------------------------------------------------
-- Rodam antes de existir contexto de ator, por isso são SECURITY DEFINER e devolvem só
-- o mínimo. Ninguém executa por padrão; o papel do app recebe EXECUTE explicitamente.

create function proj_hub_gestao.agent_key_lookup(p_prefix text)
returns table (
  key_id uuid,
  key_hash text,
  agent_id uuid,
  agent_name text,
  agent_kind proj_hub_gestao.agent_kind,
  agent_status proj_hub_gestao.agent_status,
  agent_roles text[],
  workspace_id uuid,
  scopes text[],
  project_ids uuid[],
  expires_at timestamptz,
  revoked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select k.id, k.key_hash, a.id, a.name, a.kind, a.status, a.roles, k.workspace_id,
         k.scopes, k.project_ids, k.expires_at, k.revoked_at
  from proj_hub_gestao.agent_api_keys k
  join proj_hub_gestao.agents a on a.id = k.agent_id and a.workspace_id = k.workspace_id
  where k.key_prefix = p_prefix
$$;
revoke all on function proj_hub_gestao.agent_key_lookup(text) from public;

create function proj_hub_gestao.workspace_id_by_slug(p_slug text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id from proj_hub_gestao.workspaces w where w.slug = p_slug
$$;
revoke all on function proj_hub_gestao.workspace_id_by_slug(text) from public;
