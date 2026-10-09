-- Hub de Gestão · 0002 · Trabalho em três camadas
-- Camada 1 (estratégica): projetos e marcos.
-- Camada 2 (tática): frentes por departamento.
-- Camada 3 (operacional): tarefas, checklists, tempo. Tarefa nunca é visível ao cliente.

create type proj_hub_gestao.project_status as enum ('in_review', 'discovery', 'active', 'paused', 'delivered', 'archived');
create type proj_hub_gestao.project_phase as enum ('descobrir', 'validar', 'escalar');
create type proj_hub_gestao.project_health as enum ('healthy', 'attention', 'at_risk');
create type proj_hub_gestao.milestone_status as enum ('planned', 'in_progress', 'delivered', 'accepted');
create type proj_hub_gestao.workstream_status as enum ('planned', 'in_progress', 'blocked', 'done');
create type proj_hub_gestao.status_category as enum ('todo', 'in_progress', 'review', 'blocked', 'done');
create type proj_hub_gestao.task_priority as enum ('urgent', 'high', 'normal', 'low');

-- Projetos ----------------------------------------------------------------------

create table proj_hub_gestao.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  client_id uuid not null references proj_hub_gestao.clients(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9]{2,8}$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  objective_internal text check (objective_internal is null or char_length(objective_internal) <= 4000),
  objective_client text check (objective_client is null or char_length(objective_client) <= 2000),
  phase proj_hub_gestao.project_phase not null default 'descobrir',
  status proj_hub_gestao.project_status not null default 'discovery',
  start_date date,
  target_date date,
  owner_profile_id uuid references proj_hub_gestao.profiles(id) on delete set null,
  pm_agent_id uuid,
  repo_url text,
  plan_path text,
  require_evidence boolean not null default true,
  client_can_confirm_receipt boolean not null default false,
  health proj_hub_gestao.project_health not null default 'healthy',
  health_reason jsonb not null default '{}'::jsonb check (jsonb_typeof(health_reason) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, code),
  unique (workspace_id, id)
);
create index projects_client_idx on proj_hub_gestao.projects (client_id);
create trigger projects_touch before update on proj_hub_gestao.projects
  for each row execute function proj_hub_gestao.touch_updated_at();

create table proj_hub_gestao.project_departments (
  workspace_id uuid not null,
  project_id uuid not null,
  department_id uuid not null references proj_hub_gestao.departments(id) on delete restrict,
  primary key (project_id, department_id),
  foreign key (workspace_id, project_id) references proj_hub_gestao.projects(workspace_id, id) on delete cascade
);

create table proj_hub_gestao.project_members (
  workspace_id uuid not null,
  project_id uuid not null,
  profile_id uuid not null references proj_hub_gestao.profiles(id) on delete restrict,
  role proj_hub_gestao.project_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (project_id, profile_id),
  foreign key (workspace_id, project_id) references proj_hub_gestao.projects(workspace_id, id) on delete cascade
);
create index project_members_profile_idx on proj_hub_gestao.project_members (profile_id);

-- Camada 1 · Marcos -----------------------------------------------------------------

create table proj_hub_gestao.milestones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  code text not null check (code ~ '^M[0-9]{1,3}$'),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  title_client text check (title_client is null or char_length(title_client) <= 200),
  description_client text check (description_client is null or char_length(description_client) <= 2000),
  due_date date,
  sort_order integer not null default 0,
  gate_required boolean not null default true,
  status proj_hub_gestao.milestone_status not null default 'planned',
  delivered_at timestamptz,
  accepted_at timestamptz,
  accepted_by_profile_id uuid references proj_hub_gestao.profiles(id) on delete restrict,
  acceptance_criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(acceptance_criteria) = 'array'),
  visibility proj_hub_gestao.visibility not null default 'client',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (project_id, code),
  unique (workspace_id, id),
  foreign key (workspace_id, project_id) references proj_hub_gestao.projects(workspace_id, id) on delete cascade,
  constraint milestones_acceptance_state check (
    (status = 'accepted' and accepted_at is not null and accepted_by_profile_id is not null)
    or (status <> 'accepted')
  )
);
create index milestones_project_idx on proj_hub_gestao.milestones (project_id, sort_order);
create trigger milestones_touch before update on proj_hub_gestao.milestones
  for each row execute function proj_hub_gestao.touch_updated_at();

create table proj_hub_gestao.milestone_date_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  milestone_id uuid not null references proj_hub_gestao.milestones(id) on delete cascade,
  old_due date,
  new_due date,
  reason_internal text,
  approval_id uuid,
  changed_by_type proj_hub_gestao.actor_type not null,
  changed_by_id uuid,
  created_at timestamptz not null default now()
);
create index milestone_date_history_milestone_idx on proj_hub_gestao.milestone_date_history (milestone_id);

-- Camada 2 · Frentes ------------------------------------------------------------------

create table proj_hub_gestao.workstreams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  milestone_id uuid references proj_hub_gestao.milestones(id) on delete set null,
  department_id uuid references proj_hub_gestao.departments(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  title_client text check (title_client is null or char_length(title_client) <= 200),
  description_internal text check (description_internal is null or char_length(description_internal) <= 4000),
  description_client text check (description_client is null or char_length(description_client) <= 2000),
  visibility proj_hub_gestao.visibility not null default 'internal',
  status proj_hub_gestao.workstream_status not null default 'planned',
  sort_order integer not null default 0,
  assignee_type proj_hub_gestao.actor_type,
  assignee_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, project_id) references proj_hub_gestao.projects(workspace_id, id) on delete cascade,
  constraint workstreams_assignee_pair check ((assignee_type is null) = (assignee_id is null)),
  -- Frente só aparece ao cliente com título escrito para ele.
  constraint workstreams_client_text check (visibility = 'internal' or title_client is not null)
);
create index workstreams_project_idx on proj_hub_gestao.workstreams (project_id, sort_order);
create index workstreams_milestone_idx on proj_hub_gestao.workstreams (milestone_id);
create trigger workstreams_touch before update on proj_hub_gestao.workstreams
  for each row execute function proj_hub_gestao.touch_updated_at();

create table proj_hub_gestao.workstream_dependencies (
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  workstream_id uuid not null references proj_hub_gestao.workstreams(id) on delete cascade,
  depends_on_id uuid not null references proj_hub_gestao.workstreams(id) on delete cascade,
  primary key (workstream_id, depends_on_id),
  check (workstream_id <> depends_on_id)
);

-- Camada 3 · Tarefas ------------------------------------------------------------------

create table proj_hub_gestao.task_statuses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default '#8E93A3' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  category proj_hub_gestao.status_category not null,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  unique (project_id, name),
  unique (project_id, id),
  foreign key (workspace_id, project_id) references proj_hub_gestao.projects(workspace_id, id) on delete cascade
);
create unique index task_statuses_one_default
  on proj_hub_gestao.task_statuses (project_id) where is_default;

create table proj_hub_gestao.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  workstream_id uuid references proj_hub_gestao.workstreams(id) on delete set null,
  parent_task_id uuid references proj_hub_gestao.tasks(id) on delete cascade,
  code text not null check (code ~ '^[A-Z]{2,6}-[0-9]{1,9}$'),
  title text not null check (char_length(btrim(title)) between 1 and 300),
  description_md text check (description_md is null or char_length(description_md) <= 20000),
  status_id uuid not null,
  status_category proj_hub_gestao.status_category not null default 'todo',
  priority proj_hub_gestao.task_priority not null default 'normal',
  assignee_type proj_hub_gestao.actor_type,
  assignee_id uuid,
  start_date date,
  due_date date,
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes > 0),
  sort_key double precision not null default 0,
  source text not null default 'hub' check (source in ('hub', 'plan_md', 'api', 'mcp', 'github', 'import')),
  external_ref text,
  done_evidence text check (done_evidence is null or char_length(done_evidence) <= 2000),
  completed_at timestamptz,
  completed_by_type proj_hub_gestao.actor_type,
  completed_by_id uuid,
  blocked_reason text check (blocked_reason is null or char_length(blocked_reason) <= 2000),
  created_by_type proj_hub_gestao.actor_type not null,
  created_by_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, code),
  foreign key (workspace_id, project_id) references proj_hub_gestao.projects(workspace_id, id) on delete cascade,
  foreign key (project_id, status_id) references proj_hub_gestao.task_statuses(project_id, id) on delete restrict,
  constraint tasks_assignee_pair check ((assignee_type is null) = (assignee_id is null)),
  constraint tasks_not_own_parent check (parent_task_id is null or parent_task_id <> id),
  constraint tasks_done_state check (
    (status_category = 'done' and completed_at is not null)
    or (status_category <> 'done' and completed_at is null)
  )
);
create index tasks_project_idx on proj_hub_gestao.tasks (project_id, status_category);
create index tasks_workstream_idx on proj_hub_gestao.tasks (workstream_id);
create index tasks_assignee_idx on proj_hub_gestao.tasks (assignee_type, assignee_id) where archived_at is null;
create index tasks_parent_idx on proj_hub_gestao.tasks (parent_task_id);

-- Mantém a categoria do status em sincronia e conta versões (para If-Match / ETag).
create function proj_hub_gestao.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category proj_hub_gestao.status_category;
begin
  select s.category into v_category
  from proj_hub_gestao.task_statuses s
  where s.id = new.status_id and s.project_id = new.project_id;
  if v_category is null then
    raise exception 'status % não pertence ao projeto %', new.status_id, new.project_id;
  end if;
  new.status_category := v_category;

  -- Data de conclusão controlada aqui, para nunca ficar inconsistente.
  if new.status_category = 'done' then
    if new.completed_at is null then
      new.completed_at := pg_catalog.now();
    end if;
    -- Regra do projeto: concluir exige evidência (decisão da Harmony, padrão ligado).
    if coalesce(pg_catalog.btrim(new.done_evidence), '') = '' and exists (
      select 1 from proj_hub_gestao.projects pr
      where pr.id = new.project_id and pr.require_evidence
    ) then
      raise exception 'evidência obrigatória para concluir a tarefa %', new.code
        using errcode = 'check_violation';
    end if;
  else
    new.completed_at := null;
    new.completed_by_type := null;
    new.completed_by_id := null;
  end if;

  if new.parent_task_id is not null then
    if not exists (
      select 1 from proj_hub_gestao.tasks p
      where p.id = new.parent_task_id and p.project_id = new.project_id and p.parent_task_id is null
    ) then
      raise exception 'subtarefa precisa de uma tarefa-pai do mesmo projeto, com um nível só';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := pg_catalog.now();
  end if;
  return new;
end;
$$;
create trigger tasks_before_write before insert or update on proj_hub_gestao.tasks
  for each row execute function proj_hub_gestao.tasks_before_write();

create table proj_hub_gestao.task_dependencies (
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  task_id uuid not null references proj_hub_gestao.tasks(id) on delete cascade,
  blocks_task_id uuid not null references proj_hub_gestao.tasks(id) on delete cascade,
  primary key (task_id, blocks_task_id),
  check (task_id <> blocks_task_id)
);

create table proj_hub_gestao.labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  color text not null default '#8E93A3' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  unique (workspace_id, name)
);

create table proj_hub_gestao.task_labels (
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  task_id uuid not null references proj_hub_gestao.tasks(id) on delete cascade,
  label_id uuid not null references proj_hub_gestao.labels(id) on delete cascade,
  primary key (task_id, label_id)
);

create table proj_hub_gestao.checklist_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  task_id uuid not null references proj_hub_gestao.tasks(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 300),
  done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index checklist_items_task_idx on proj_hub_gestao.checklist_items (task_id, sort_order);
create trigger checklist_items_touch before update on proj_hub_gestao.checklist_items
  for each row execute function proj_hub_gestao.touch_updated_at();

-- Comentários e anexos valem para projeto, marco, frente ou tarefa. Nascem internos.
create table proj_hub_gestao.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  entity_type text not null check (entity_type in ('project', 'milestone', 'workstream', 'task')),
  entity_id uuid not null,
  body_md text not null check (char_length(btrim(body_md)) between 1 and 10000),
  visibility proj_hub_gestao.visibility not null default 'internal',
  author_type proj_hub_gestao.actor_type not null,
  author_id uuid,
  author_name text not null check (char_length(btrim(author_name)) between 1 and 120),
  acting_role text,
  mentions jsonb not null default '[]'::jsonb check (jsonb_typeof(mentions) = 'array'),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  foreign key (workspace_id, project_id) references proj_hub_gestao.projects(workspace_id, id) on delete cascade,
  -- Comentário sobre tarefa é sempre interno.
  constraint comments_task_internal check (entity_type <> 'task' or visibility = 'internal')
);
create index comments_entity_idx on proj_hub_gestao.comments (entity_type, entity_id, created_at);

create table proj_hub_gestao.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  entity_type text not null check (entity_type in ('project', 'milestone', 'workstream', 'task')),
  entity_id uuid not null,
  storage_path text not null,
  filename text not null,
  mime text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  visibility proj_hub_gestao.visibility not null default 'internal',
  uploaded_by_type proj_hub_gestao.actor_type not null,
  uploaded_by_id uuid,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references proj_hub_gestao.projects(workspace_id, id) on delete cascade,
  constraint attachments_task_internal check (entity_type <> 'task' or visibility = 'internal')
);
create index attachments_entity_idx on proj_hub_gestao.attachments (entity_type, entity_id);

create table proj_hub_gestao.time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  task_id uuid not null references proj_hub_gestao.tasks(id) on delete cascade,
  actor_type proj_hub_gestao.actor_type not null,
  actor_id uuid,
  minutes integer not null check (minutes > 0 and minutes <= 24 * 60),
  entry_date date not null default current_date,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index time_entries_task_idx on proj_hub_gestao.time_entries (task_id);

-- Código sequencial por workspace (HUB-1, HUB-2...). Imutável depois de criado.
create function proj_hub_gestao.next_task_code(p_workspace_id uuid)
returns text
language sql
set search_path = ''
as $$
  update proj_hub_gestao.workspaces
     set task_seq = task_seq + 1
   where id = p_workspace_id
  returning task_prefix || '-' || task_seq
$$;

-- Regras de acesso (RLS) ------------------------------------------------------------

alter table proj_hub_gestao.projects enable row level security;
alter table proj_hub_gestao.project_departments enable row level security;
alter table proj_hub_gestao.project_members enable row level security;
alter table proj_hub_gestao.milestones enable row level security;
alter table proj_hub_gestao.milestone_date_history enable row level security;
alter table proj_hub_gestao.workstreams enable row level security;
alter table proj_hub_gestao.workstream_dependencies enable row level security;
alter table proj_hub_gestao.task_statuses enable row level security;
alter table proj_hub_gestao.tasks enable row level security;
alter table proj_hub_gestao.task_dependencies enable row level security;
alter table proj_hub_gestao.labels enable row level security;
alter table proj_hub_gestao.task_labels enable row level security;
alter table proj_hub_gestao.checklist_items enable row level security;
alter table proj_hub_gestao.comments enable row level security;
alter table proj_hub_gestao.attachments enable row level security;
alter table proj_hub_gestao.time_entries enable row level security;

-- Projeto visível ao cliente: dele, fora de revisão e não arquivado.
create function proj_hub_gestao.project_visible_to_client(p_project_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select proj_hub_gestao.actor_is_client() and exists (
    select 1 from proj_hub_gestao.projects p
    where p.id = p_project_id
      and p.workspace_id = proj_hub_gestao.current_workspace_id()
      and p.client_id = proj_hub_gestao.current_client_id()
      and p.status not in ('in_review', 'archived')
  )
$$;

create policy projects_internal on proj_hub_gestao.projects for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy projects_client_read on proj_hub_gestao.projects for select
  using (
    proj_hub_gestao.actor_is_client()
    and workspace_id = proj_hub_gestao.current_workspace_id()
    and client_id = proj_hub_gestao.current_client_id()
    and status not in ('in_review', 'archived')
  );

create policy milestones_internal on proj_hub_gestao.milestones for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy milestones_client_read on proj_hub_gestao.milestones for select
  using (visibility = 'client' and archived_at is null and proj_hub_gestao.project_visible_to_client(project_id));

create policy workstreams_internal on proj_hub_gestao.workstreams for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy workstreams_client_read on proj_hub_gestao.workstreams for select
  using (visibility = 'client' and archived_at is null and proj_hub_gestao.project_visible_to_client(project_id));

create policy comments_internal on proj_hub_gestao.comments for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy comments_client_read on proj_hub_gestao.comments for select
  using (visibility = 'client' and proj_hub_gestao.project_visible_to_client(project_id));
create policy comments_client_write on proj_hub_gestao.comments for insert
  with check (
    visibility = 'client'
    and entity_type = 'project'
    and author_type = 'user'
    and author_id = proj_hub_gestao.current_actor_id()
    and proj_hub_gestao.project_visible_to_client(project_id)
  );

create policy attachments_internal on proj_hub_gestao.attachments for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy attachments_client_read on proj_hub_gestao.attachments for select
  using (visibility = 'client' and proj_hub_gestao.project_visible_to_client(project_id));

-- Tabelas só internas: o cliente nunca lê.
create policy project_departments_internal on proj_hub_gestao.project_departments for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy project_members_internal on proj_hub_gestao.project_members for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy milestone_date_history_internal on proj_hub_gestao.milestone_date_history for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy workstream_dependencies_internal on proj_hub_gestao.workstream_dependencies for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy task_statuses_internal on proj_hub_gestao.task_statuses for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy tasks_internal on proj_hub_gestao.tasks for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy task_dependencies_internal on proj_hub_gestao.task_dependencies for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy labels_internal on proj_hub_gestao.labels for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy task_labels_internal on proj_hub_gestao.task_labels for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy checklist_items_internal on proj_hub_gestao.checklist_items for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy time_entries_internal on proj_hub_gestao.time_entries for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
