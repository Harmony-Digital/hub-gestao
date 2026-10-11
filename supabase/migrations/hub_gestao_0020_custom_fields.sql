-- Hub de Gestão · 0020 · campos personalizados das tarefas (RF-19, M7)
--
-- Cada projeto pode ter campos próprios nas tarefas: texto, número, seleção (com as
-- opções), data ou endereço (URL). O valor fica guardado como texto já conferido pelo
-- servidor (número normalizado, data AAAA-MM-DD, URL http ou https, opção que existe).
-- Tudo é interno: o cliente nunca vê tarefa nem campo de tarefa.

create type proj_hub_gestao.custom_field_kind as enum ('text', 'number', 'select', 'date', 'url');

create table proj_hub_gestao.custom_fields (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind proj_hub_gestao.custom_field_kind not null,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, project_id)
    references proj_hub_gestao.projects(workspace_id, id) on delete cascade
);

create unique index custom_fields_project_name_idx
  on proj_hub_gestao.custom_fields (project_id, lower(name));
create index custom_fields_workspace_project_idx on proj_hub_gestao.custom_fields (workspace_id, project_id);

create table proj_hub_gestao.custom_field_values (
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  task_id uuid not null references proj_hub_gestao.tasks(id) on delete cascade,
  field_id uuid not null references proj_hub_gestao.custom_fields(id) on delete cascade,
  value text not null check (char_length(value) between 1 and 500),
  updated_at timestamptz not null default now(),
  primary key (task_id, field_id)
);

create index custom_field_values_field_idx on proj_hub_gestao.custom_field_values (field_id);
create index custom_field_values_workspace_idx on proj_hub_gestao.custom_field_values (workspace_id);

alter table proj_hub_gestao.custom_fields enable row level security;
alter table proj_hub_gestao.custom_field_values enable row level security;

create policy custom_fields_internal on proj_hub_gestao.custom_fields for all
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

create policy custom_field_values_internal on proj_hub_gestao.custom_field_values for all
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

-- O papel do app em produção recebe acesso às tabelas novas (no banco local o papel é
-- outro e recebe as permissões ao subir).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant select, insert, update, delete on proj_hub_gestao.custom_fields to hub_gestao_app;
    grant select, insert, update, delete on proj_hub_gestao.custom_field_values to hub_gestao_app;
  end if;
end
$$;
