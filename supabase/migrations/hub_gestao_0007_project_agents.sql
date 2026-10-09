-- Hub de Gestão · 0007 · Agentes por projeto
-- Quais agentes atuam em cada projeto e com qual papel do catálogo AGENTES.md
-- (ex.: o Kratos como GP-01 e VP-05 no projeto HUB). PRD §11: project_agents.

-- Permite chave estrangeira composta que garante agente e projeto do mesmo workspace.
alter table proj_hub_gestao.agents
  add constraint agents_workspace_id_id_key unique (workspace_id, id);

create table proj_hub_gestao.project_agents (
  workspace_id uuid not null,
  project_id uuid not null,
  agent_id uuid not null,
  role text not null check (role ~ '^[A-Z]{2}-[0-9]{2}$'),
  created_at timestamptz not null default now(),
  primary key (project_id, agent_id, role),
  foreign key (workspace_id, project_id) references proj_hub_gestao.projects(workspace_id, id) on delete cascade,
  foreign key (workspace_id, agent_id) references proj_hub_gestao.agents(workspace_id, id) on delete cascade
);
create index project_agents_project_idx on proj_hub_gestao.project_agents (workspace_id, project_id);
create index project_agents_agent_idx on proj_hub_gestao.project_agents (workspace_id, agent_id);

alter table proj_hub_gestao.project_agents enable row level security;
create policy project_agents_internal on proj_hub_gestao.project_agents for all
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
