-- Hub de Gestão · 0001 · Fundação
-- Workspace, pessoas, clientes, departamentos, tipos e contexto do ator.
--
-- Escopo: somente o schema proj_hub_gestao, registrado por harmony_admin.create_project.
-- Não cria papéis, não toca Auth, Storage, PostgREST nem outros schemas.
--
-- Contexto do ator (definido pelo servidor do Hub a cada transação, com set_config local):
--   hub.workspace_id  uuid do workspace
--   hub.actor_type    user | agent | system
--   hub.actor_id      uuid do perfil ou do agente
--   hub.actor_scope   internal | client
--   hub.client_id     uuid do cliente, quando o ator é contato de cliente
-- Sem contexto, as políticas não deixam ver nada (fail-closed).

-- Tipos ---------------------------------------------------------------------

create type proj_hub_gestao.workspace_role as enum ('owner', 'admin', 'member');
create type proj_hub_gestao.project_role as enum ('lead', 'member', 'client_viewer', 'client_approver', 'guest');
create type proj_hub_gestao.actor_type as enum ('user', 'agent', 'system');
create type proj_hub_gestao.visibility as enum ('internal', 'client');
create type proj_hub_gestao.access_status as enum ('none', 'invited', 'active', 'revoked');

-- Contexto do ator ------------------------------------------------------------

create function proj_hub_gestao.current_workspace_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('hub.workspace_id', true), '')::uuid
$$;

create function proj_hub_gestao.current_actor_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('hub.actor_id', true), '')::uuid
$$;

create function proj_hub_gestao.current_actor_type()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('hub.actor_type', true), '')
$$;

create function proj_hub_gestao.current_client_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('hub.client_id', true), '')::uuid
$$;

-- Verdadeiro só para atores internos (equipe e agentes) com workspace definido.
create function proj_hub_gestao.actor_is_internal()
returns boolean
language sql
stable
set search_path = ''
as $$
  select proj_hub_gestao.current_workspace_id() is not null
     and coalesce(pg_catalog.current_setting('hub.actor_scope', true), '') = 'internal'
$$;

-- Verdadeiro só para contatos de cliente com workspace e cliente definidos.
create function proj_hub_gestao.actor_is_client()
returns boolean
language sql
stable
set search_path = ''
as $$
  select proj_hub_gestao.current_workspace_id() is not null
     and proj_hub_gestao.current_client_id() is not null
     and coalesce(pg_catalog.current_setting('hub.actor_scope', true), '') = 'client'
$$;

create function proj_hub_gestao.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Workspace -------------------------------------------------------------------

create table proj_hub_gestao.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  task_prefix text not null default 'HUB' check (task_prefix ~ '^[A-Z]{2,6}$'),
  task_seq bigint not null default 0 check (task_seq >= 0),
  branding jsonb not null default '{}'::jsonb check (jsonb_typeof(branding) = 'object'),
  timezone text not null default 'America/Sao_Paulo',
  locale text not null default 'pt-BR',
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger workspaces_touch before update on proj_hub_gestao.workspaces
  for each row execute function proj_hub_gestao.touch_updated_at();

-- Pessoas ---------------------------------------------------------------------

create table proj_hub_gestao.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null check (char_length(email) between 3 and 254 and position('@' in email) > 1),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  avatar_url text,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_active_unique
  on proj_hub_gestao.profiles (lower(email)) where deactivated_at is null;
create trigger profiles_touch before update on proj_hub_gestao.profiles
  for each row execute function proj_hub_gestao.touch_updated_at();

create table proj_hub_gestao.memberships (
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  profile_id uuid not null references proj_hub_gestao.profiles(id) on delete restrict,
  role proj_hub_gestao.workspace_role not null default 'member',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, profile_id)
);
create index memberships_profile_idx on proj_hub_gestao.memberships (profile_id);
create trigger memberships_touch before update on proj_hub_gestao.memberships
  for each row execute function proj_hub_gestao.touch_updated_at();

-- Clientes ----------------------------------------------------------------------

create table proj_hub_gestao.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  segment text,
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path text,
  notes_internal text check (notes_internal is null or char_length(notes_internal) <= 4000),
  portal_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, slug)
);
create trigger clients_touch before update on proj_hub_gestao.clients
  for each row execute function proj_hub_gestao.touch_updated_at();

-- Contato de cliente nasce sem acesso; só o owner libera (decisão D9).
create table proj_hub_gestao.client_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  client_id uuid not null references proj_hub_gestao.clients(id) on delete restrict,
  profile_id uuid references proj_hub_gestao.profiles(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254 and position('@' in email) > 1),
  role text not null default 'client_viewer' check (role in ('client_viewer', 'client_approver')),
  access_status proj_hub_gestao.access_status not null default 'none',
  invited_at timestamptz,
  invited_by_profile_id uuid references proj_hub_gestao.profiles(id) on delete restrict,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index client_contacts_email_unique
  on proj_hub_gestao.client_contacts (client_id, lower(email));
create index client_contacts_profile_idx on proj_hub_gestao.client_contacts (profile_id);
create trigger client_contacts_touch before update on proj_hub_gestao.client_contacts
  for each row execute function proj_hub_gestao.touch_updated_at();

-- Departamentos -------------------------------------------------------------------

create table proj_hub_gestao.departments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  color text not null default '#4A5061' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  lead_profile_id uuid references proj_hub_gestao.profiles(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
create trigger departments_touch before update on proj_hub_gestao.departments
  for each row execute function proj_hub_gestao.touch_updated_at();

-- Regras de acesso (RLS) --------------------------------------------------------------
-- O servidor do Hub decide quem pode o quê (authorize). Estas políticas são a segunda
-- linha: isolam o workspace e impedem que um contato de cliente veja dados internos.

alter table proj_hub_gestao.workspaces enable row level security;
alter table proj_hub_gestao.profiles enable row level security;
alter table proj_hub_gestao.memberships enable row level security;
alter table proj_hub_gestao.clients enable row level security;
alter table proj_hub_gestao.client_contacts enable row level security;
alter table proj_hub_gestao.departments enable row level security;

create policy workspaces_internal on proj_hub_gestao.workspaces for all
  using (proj_hub_gestao.actor_is_internal() and id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and id = proj_hub_gestao.current_workspace_id());
create policy workspaces_client_read on proj_hub_gestao.workspaces for select
  using (proj_hub_gestao.actor_is_client() and id = proj_hub_gestao.current_workspace_id());

create policy profiles_read on proj_hub_gestao.profiles for select
  using (
    id = proj_hub_gestao.current_actor_id()
    or exists (
      select 1 from proj_hub_gestao.memberships m
      where m.profile_id = profiles.id and m.workspace_id = proj_hub_gestao.current_workspace_id()
    )
    or (
      proj_hub_gestao.actor_is_internal()
      and exists (
        select 1 from proj_hub_gestao.client_contacts c
        where c.profile_id = profiles.id and c.workspace_id = proj_hub_gestao.current_workspace_id()
      )
    )
  );
create policy profiles_internal_write on proj_hub_gestao.profiles for insert
  with check (proj_hub_gestao.actor_is_internal());
create policy profiles_internal_update on proj_hub_gestao.profiles for update
  using (proj_hub_gestao.actor_is_internal())
  with check (proj_hub_gestao.actor_is_internal());

create policy memberships_internal on proj_hub_gestao.memberships for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());

create policy clients_internal on proj_hub_gestao.clients for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy clients_own_read on proj_hub_gestao.clients for select
  using (
    proj_hub_gestao.actor_is_client()
    and workspace_id = proj_hub_gestao.current_workspace_id()
    and id = proj_hub_gestao.current_client_id()
  );

create policy client_contacts_internal on proj_hub_gestao.client_contacts for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
create policy client_contacts_own_read on proj_hub_gestao.client_contacts for select
  using (
    proj_hub_gestao.actor_is_client()
    and workspace_id = proj_hub_gestao.current_workspace_id()
    and profile_id = proj_hub_gestao.current_actor_id()
  );

create policy departments_internal on proj_hub_gestao.departments for all
  using (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id())
  with check (proj_hub_gestao.actor_is_internal() and workspace_id = proj_hub_gestao.current_workspace_id());
