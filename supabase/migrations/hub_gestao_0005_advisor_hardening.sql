-- Hub de Gestão · 0005 · Ajustes pedidos pelos alertas do Supabase
-- 1. Uma única política permissiva por tabela e ação (alerta multiple_permissive_policies).
-- 2. Funções de contexto escritas como (select f()): o Postgres calcula uma vez por consulta
--    (InitPlan), e não uma vez por linha.
-- 3. Índices que cobrem as chaves estrangeiras (alerta unindexed_foreign_keys).
-- 4. Alguns apertos de segurança aproveitando a reescrita:
--    - registro de atividades só aceita linha em nome do próprio ator;
--    - a equipe só altera perfis ligados ao próprio workspace;
--    - o contato de cliente só lê o próprio cadastro no cliente em que entrou;
--    - comentário e anexo de projeto apontam para o próprio projeto;
--    - workspace não pode ser apagado pela aplicação.
-- Nenhuma regra fica mais aberta do que antes.

-- Tabelas só internas (equipe e agentes do workspace) -----------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'memberships', 'departments',
    'project_departments', 'project_members', 'milestone_date_history', 'workstream_dependencies',
    'task_statuses', 'tasks', 'task_dependencies', 'labels', 'task_labels', 'checklist_items',
    'time_entries',
    'llm_credentials', 'agents', 'agent_api_keys', 'agent_runs', 'approvals', 'notifications',
    'notification_prefs', 'webhooks', 'webhook_deliveries', 'idempotency_keys', 'jobs',
    'plan_sync_runs', 'saved_views', 'project_templates'
  ] loop
    execute format('drop policy %I on proj_hub_gestao.%I', t || '_internal', t);
    execute format(
      'create policy %I on proj_hub_gestao.%I for all
         using ((select proj_hub_gestao.actor_is_internal())
                and workspace_id = (select proj_hub_gestao.current_workspace_id()))
         with check ((select proj_hub_gestao.actor_is_internal())
                     and workspace_id = (select proj_hub_gestao.current_workspace_id()))',
      t || '_internal', t);
  end loop;
end
$$;

-- Registro de atividades: leitura interna; inserção só em nome do próprio ator.
drop policy activity_log_internal_read on proj_hub_gestao.activity_log;
drop policy activity_log_internal_insert on proj_hub_gestao.activity_log;
create policy activity_log_internal_read on proj_hub_gestao.activity_log for select
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy activity_log_internal_insert on proj_hub_gestao.activity_log for insert
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
    and actor_type::text = (select proj_hub_gestao.current_actor_type())
    and actor_id is not distinct from (select proj_hub_gestao.current_actor_id())
  );

-- Workspace -------------------------------------------------------------------------

drop policy workspaces_internal on proj_hub_gestao.workspaces;
drop policy workspaces_client_read on proj_hub_gestao.workspaces;
create policy workspaces_read on proj_hub_gestao.workspaces for select
  using (
    id = (select proj_hub_gestao.current_workspace_id())
    and ((select proj_hub_gestao.actor_is_internal()) or (select proj_hub_gestao.actor_is_client()))
  );
create policy workspaces_insert on proj_hub_gestao.workspaces for insert
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and id = (select proj_hub_gestao.current_workspace_id())
  );
create policy workspaces_update on proj_hub_gestao.workspaces for update
  using (
    (select proj_hub_gestao.actor_is_internal())
    and id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and id = (select proj_hub_gestao.current_workspace_id())
  );
-- Sem política de exclusão: a aplicação nunca apaga um workspace.

-- Perfis ----------------------------------------------------------------------------

drop policy profiles_read on proj_hub_gestao.profiles;
drop policy profiles_internal_write on proj_hub_gestao.profiles;
drop policy profiles_internal_update on proj_hub_gestao.profiles;
create policy profiles_read on proj_hub_gestao.profiles for select
  using (
    id = (select proj_hub_gestao.current_actor_id())
    or (
      (select proj_hub_gestao.actor_is_internal())
      and (
        exists (
          select 1 from proj_hub_gestao.memberships m
          where m.profile_id = profiles.id
            and m.workspace_id = (select proj_hub_gestao.current_workspace_id())
        )
        or exists (
          select 1 from proj_hub_gestao.client_contacts c
          where c.profile_id = profiles.id
            and c.workspace_id = (select proj_hub_gestao.current_workspace_id())
        )
      )
    )
  );
create policy profiles_insert on proj_hub_gestao.profiles for insert
  with check ((select proj_hub_gestao.actor_is_internal()));
create policy profiles_update on proj_hub_gestao.profiles for update
  using (
    (select proj_hub_gestao.actor_is_internal())
    and (
      exists (
        select 1 from proj_hub_gestao.memberships m
        where m.profile_id = profiles.id
          and m.workspace_id = (select proj_hub_gestao.current_workspace_id())
      )
      or exists (
        select 1 from proj_hub_gestao.client_contacts c
        where c.profile_id = profiles.id
          and c.workspace_id = (select proj_hub_gestao.current_workspace_id())
      )
    )
  )
  with check ((select proj_hub_gestao.actor_is_internal()));

-- Clientes e contatos ----------------------------------------------------------------

drop policy clients_internal on proj_hub_gestao.clients;
drop policy clients_own_read on proj_hub_gestao.clients;
create policy clients_read on proj_hub_gestao.clients for select
  using (
    workspace_id = (select proj_hub_gestao.current_workspace_id())
    and (
      (select proj_hub_gestao.actor_is_internal())
      or (
        (select proj_hub_gestao.actor_is_client())
        and id = (select proj_hub_gestao.current_client_id())
      )
    )
  );
create policy clients_insert on proj_hub_gestao.clients for insert
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy clients_update on proj_hub_gestao.clients for update
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy clients_delete on proj_hub_gestao.clients for delete
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

drop policy client_contacts_internal on proj_hub_gestao.client_contacts;
drop policy client_contacts_own_read on proj_hub_gestao.client_contacts;
create policy client_contacts_read on proj_hub_gestao.client_contacts for select
  using (
    workspace_id = (select proj_hub_gestao.current_workspace_id())
    and (
      (select proj_hub_gestao.actor_is_internal())
      or (
        (select proj_hub_gestao.actor_is_client())
        and client_id = (select proj_hub_gestao.current_client_id())
        and profile_id = (select proj_hub_gestao.current_actor_id())
      )
    )
  );
create policy client_contacts_insert on proj_hub_gestao.client_contacts for insert
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy client_contacts_update on proj_hub_gestao.client_contacts for update
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy client_contacts_delete on proj_hub_gestao.client_contacts for delete
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

-- Projetos --------------------------------------------------------------------------

drop policy projects_internal on proj_hub_gestao.projects;
drop policy projects_client_read on proj_hub_gestao.projects;
create policy projects_read on proj_hub_gestao.projects for select
  using (
    workspace_id = (select proj_hub_gestao.current_workspace_id())
    and (
      (select proj_hub_gestao.actor_is_internal())
      or (
        (select proj_hub_gestao.actor_is_client())
        and client_id = (select proj_hub_gestao.current_client_id())
        and status not in ('in_review', 'archived')
      )
    )
  );
create policy projects_insert on proj_hub_gestao.projects for insert
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy projects_update on proj_hub_gestao.projects for update
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy projects_delete on proj_hub_gestao.projects for delete
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

-- Marcos e frentes ------------------------------------------------------------------

drop policy milestones_internal on proj_hub_gestao.milestones;
drop policy milestones_client_read on proj_hub_gestao.milestones;
create policy milestones_read on proj_hub_gestao.milestones for select
  using (
    workspace_id = (select proj_hub_gestao.current_workspace_id())
    and (
      (select proj_hub_gestao.actor_is_internal())
      or (
        (select proj_hub_gestao.actor_is_client())
        and visibility = 'client'
        and archived_at is null
        and proj_hub_gestao.project_visible_to_client(project_id)
      )
    )
  );
create policy milestones_insert on proj_hub_gestao.milestones for insert
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy milestones_update on proj_hub_gestao.milestones for update
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy milestones_delete on proj_hub_gestao.milestones for delete
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

drop policy workstreams_internal on proj_hub_gestao.workstreams;
drop policy workstreams_client_read on proj_hub_gestao.workstreams;
create policy workstreams_read on proj_hub_gestao.workstreams for select
  using (
    workspace_id = (select proj_hub_gestao.current_workspace_id())
    and (
      (select proj_hub_gestao.actor_is_internal())
      or (
        (select proj_hub_gestao.actor_is_client())
        and visibility = 'client'
        and archived_at is null
        and proj_hub_gestao.project_visible_to_client(project_id)
      )
    )
  );
create policy workstreams_insert on proj_hub_gestao.workstreams for insert
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy workstreams_update on proj_hub_gestao.workstreams for update
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy workstreams_delete on proj_hub_gestao.workstreams for delete
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

-- Comentários e anexos --------------------------------------------------------------

-- Comentário ou anexo "do projeto" aponta para o próprio projeto.
alter table proj_hub_gestao.comments
  add constraint comments_project_entity check (entity_type <> 'project' or entity_id = project_id);
alter table proj_hub_gestao.attachments
  add constraint attachments_project_entity check (entity_type <> 'project' or entity_id = project_id);

drop policy comments_internal on proj_hub_gestao.comments;
drop policy comments_client_read on proj_hub_gestao.comments;
drop policy comments_client_write on proj_hub_gestao.comments;
create policy comments_read on proj_hub_gestao.comments for select
  using (
    workspace_id = (select proj_hub_gestao.current_workspace_id())
    and (
      (select proj_hub_gestao.actor_is_internal())
      or (
        (select proj_hub_gestao.actor_is_client())
        and visibility = 'client'
        and proj_hub_gestao.project_visible_to_client(project_id)
      )
    )
  );
-- O cliente escreve só no canal do projeto, como ele mesmo.
create policy comments_insert on proj_hub_gestao.comments for insert
  with check (
    workspace_id = (select proj_hub_gestao.current_workspace_id())
    and (
      (select proj_hub_gestao.actor_is_internal())
      or (
        (select proj_hub_gestao.actor_is_client())
        and visibility = 'client'
        and entity_type = 'project'
        and author_type = 'user'
        and author_id = (select proj_hub_gestao.current_actor_id())
        and proj_hub_gestao.project_visible_to_client(project_id)
      )
    )
  );
create policy comments_update on proj_hub_gestao.comments for update
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy comments_delete on proj_hub_gestao.comments for delete
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

drop policy attachments_internal on proj_hub_gestao.attachments;
drop policy attachments_client_read on proj_hub_gestao.attachments;
create policy attachments_read on proj_hub_gestao.attachments for select
  using (
    workspace_id = (select proj_hub_gestao.current_workspace_id())
    and (
      (select proj_hub_gestao.actor_is_internal())
      or (
        (select proj_hub_gestao.actor_is_client())
        and visibility = 'client'
        and proj_hub_gestao.project_visible_to_client(project_id)
      )
    )
  );
create policy attachments_insert on proj_hub_gestao.attachments for insert
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy attachments_update on proj_hub_gestao.attachments for update
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy attachments_delete on proj_hub_gestao.attachments for delete
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

-- Relatórios ------------------------------------------------------------------------

drop policy status_reports_internal on proj_hub_gestao.status_reports;
drop policy status_reports_client_read on proj_hub_gestao.status_reports;
create policy status_reports_read on proj_hub_gestao.status_reports for select
  using (
    workspace_id = (select proj_hub_gestao.current_workspace_id())
    and (
      (select proj_hub_gestao.actor_is_internal())
      or (
        (select proj_hub_gestao.actor_is_client())
        and audience = 'client'
        and published_at is not null
        and proj_hub_gestao.project_visible_to_client(project_id)
      )
    )
  );
create policy status_reports_insert on proj_hub_gestao.status_reports for insert
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy status_reports_update on proj_hub_gestao.status_reports for update
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy status_reports_delete on proj_hub_gestao.status_reports for delete
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

-- Índices das chaves estrangeiras --------------------------------------------------------

create index activity_log_workspace_idx on proj_hub_gestao.activity_log (workspace_id, created_at desc);
create index agent_api_keys_created_by_idx on proj_hub_gestao.agent_api_keys (created_by_profile_id);
create index agent_api_keys_workspace_idx on proj_hub_gestao.agent_api_keys (workspace_id);
create index agent_runs_workspace_idx on proj_hub_gestao.agent_runs (workspace_id);
create index agents_department_idx on proj_hub_gestao.agents (department_id);
create index agents_llm_credential_idx on proj_hub_gestao.agents (llm_credential_id);
create index agents_owner_idx on proj_hub_gestao.agents (owner_profile_id);
create index approvals_approver_idx on proj_hub_gestao.approvals (approver_profile_id);
create index approvals_decided_by_idx on proj_hub_gestao.approvals (decided_by_profile_id);
create index approvals_project_idx on proj_hub_gestao.approvals (project_id);
create index attachments_project_idx on proj_hub_gestao.attachments (workspace_id, project_id);
create index checklist_items_workspace_idx on proj_hub_gestao.checklist_items (workspace_id);
create index client_contacts_invited_by_idx on proj_hub_gestao.client_contacts (invited_by_profile_id);
create index client_contacts_workspace_idx on proj_hub_gestao.client_contacts (workspace_id);
create index comments_project_idx on proj_hub_gestao.comments (workspace_id, project_id);
create index departments_lead_idx on proj_hub_gestao.departments (lead_profile_id);
create index idempotency_keys_workspace_idx on proj_hub_gestao.idempotency_keys (workspace_id);
create index jobs_workspace_idx on proj_hub_gestao.jobs (workspace_id);
create index llm_credentials_created_by_idx on proj_hub_gestao.llm_credentials (created_by_profile_id);
create index llm_credentials_workspace_idx on proj_hub_gestao.llm_credentials (workspace_id);
create index milestone_date_history_workspace_idx on proj_hub_gestao.milestone_date_history (workspace_id);
create index milestones_accepted_by_idx on proj_hub_gestao.milestones (accepted_by_profile_id);
create index milestones_workspace_project_idx on proj_hub_gestao.milestones (workspace_id, project_id);
create index notification_prefs_workspace_idx on proj_hub_gestao.notification_prefs (workspace_id);
create index notifications_workspace_idx on proj_hub_gestao.notifications (workspace_id);
create index plan_sync_runs_project_idx on proj_hub_gestao.plan_sync_runs (project_id);
create index plan_sync_runs_workspace_idx on proj_hub_gestao.plan_sync_runs (workspace_id);
create index project_departments_department_idx on proj_hub_gestao.project_departments (department_id);
create index project_departments_project_idx on proj_hub_gestao.project_departments (workspace_id, project_id);
create index project_members_project_idx on proj_hub_gestao.project_members (workspace_id, project_id);
create index projects_owner_idx on proj_hub_gestao.projects (owner_profile_id);
create index projects_pm_agent_idx on proj_hub_gestao.projects (pm_agent_id);
create index saved_views_department_idx on proj_hub_gestao.saved_views (department_id);
create index saved_views_profile_idx on proj_hub_gestao.saved_views (profile_id);
create index saved_views_project_idx on proj_hub_gestao.saved_views (project_id);
create index saved_views_workspace_idx on proj_hub_gestao.saved_views (workspace_id);
create index status_reports_approval_idx on proj_hub_gestao.status_reports (approval_id);
create index status_reports_agent_idx on proj_hub_gestao.status_reports (generated_by_agent_id);
create index status_reports_workspace_project_idx on proj_hub_gestao.status_reports (workspace_id, project_id);
create index task_dependencies_blocks_idx on proj_hub_gestao.task_dependencies (blocks_task_id);
create index task_dependencies_workspace_idx on proj_hub_gestao.task_dependencies (workspace_id);
create index task_labels_label_idx on proj_hub_gestao.task_labels (label_id);
create index task_labels_workspace_idx on proj_hub_gestao.task_labels (workspace_id);
create index task_statuses_project_idx on proj_hub_gestao.task_statuses (workspace_id, project_id);
create index tasks_status_idx on proj_hub_gestao.tasks (project_id, status_id);
create index tasks_workspace_project_idx on proj_hub_gestao.tasks (workspace_id, project_id);
create index time_entries_workspace_idx on proj_hub_gestao.time_entries (workspace_id);
create index webhook_deliveries_webhook_idx on proj_hub_gestao.webhook_deliveries (webhook_id);
create index webhook_deliveries_workspace_idx on proj_hub_gestao.webhook_deliveries (workspace_id);
create index webhooks_workspace_idx on proj_hub_gestao.webhooks (workspace_id);
create index workstream_dependencies_depends_on_idx on proj_hub_gestao.workstream_dependencies (depends_on_id);
create index workstream_dependencies_workspace_idx on proj_hub_gestao.workstream_dependencies (workspace_id);
create index workstreams_department_idx on proj_hub_gestao.workstreams (department_id);
create index workstreams_workspace_project_idx on proj_hub_gestao.workstreams (workspace_id, project_id);
