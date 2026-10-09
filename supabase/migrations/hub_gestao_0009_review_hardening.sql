-- Hub de Gestão · 0009 · Ajustes da revisão de segurança do M1
-- 1. Títulos e nomes são de uma linha: quebras de linha e outros caracteres de controle
--    são recusados, para que um título não forje linhas no plan.md exportado.
-- 2. Pedido pendente igual (mesmo tipo e mesmo item) e versão repetida de relatório são
--    recusados pelo próprio banco, mesmo com pedidos simultâneos.
-- 3. Travas de escrita para agentes, além da autorização do servidor ("A IA executa. O
--    humano decide."):
--    - texto e visibilidade para o cliente só mudam por uma pessoa ou por aprovação dela;
--    - marco: agente só muda o progresso, e só cria marco em projeto em revisão (importação);
--    - pedido de aprovação: agente só cancela o próprio pedido pendente;
--    - chaves, credenciais, membros, contatos, perfis e departamentos não são escritos por
--      agentes; nas chaves, só o último uso; no workspace, só o contador de tarefas.

-- 1. Uma linha só -------------------------------------------------------------------------

alter table proj_hub_gestao.tasks
  add constraint tasks_title_single_line check (title !~ '[[:cntrl:]]');
alter table proj_hub_gestao.workstreams
  add constraint workstreams_title_single_line
  check (title !~ '[[:cntrl:]]' and (title_client is null or title_client !~ '[[:cntrl:]]'));
alter table proj_hub_gestao.milestones
  add constraint milestones_title_single_line
  check (title !~ '[[:cntrl:]]' and (title_client is null or title_client !~ '[[:cntrl:]]'));
alter table proj_hub_gestao.projects
  add constraint projects_name_single_line check (name !~ '[[:cntrl:]]');
alter table proj_hub_gestao.approvals
  add constraint approvals_title_single_line check (title !~ '[[:cntrl:]]');
alter table proj_hub_gestao.clients
  add constraint clients_name_single_line check (name !~ '[[:cntrl:]]');
alter table proj_hub_gestao.agents
  add constraint agents_name_single_line check (name !~ '[[:cntrl:]]');
alter table proj_hub_gestao.departments
  add constraint departments_name_single_line check (name !~ '[[:cntrl:]]');

-- 2. Unicidade sob concorrência ---------------------------------------------------------------

create unique index approvals_one_pending_per_item
  on proj_hub_gestao.approvals (type, entity_id)
  where status = 'pending' and entity_id is not null;
create unique index status_reports_version_unique
  on proj_hub_gestao.status_reports (project_id, period_start, period_end, audience, version);

-- 3. Travas de escrita para agentes ------------------------------------------------------------

create function proj_hub_gestao.actor_is_agent()
returns boolean
language sql
stable
set search_path = ''
as $$
  select proj_hub_gestao.current_actor_type() is not distinct from 'agent'
$$;

-- Tabelas que agente nunca escreve.
create function proj_hub_gestao.agent_never_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if proj_hub_gestao.actor_is_agent() then
    raise exception 'agentes não alteram %; isso é feito por uma pessoa', tg_table_name
      using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger llm_credentials_agent_guard before insert or update or delete on proj_hub_gestao.llm_credentials
  for each row execute function proj_hub_gestao.agent_never_writes();
create trigger memberships_agent_guard before insert or update or delete on proj_hub_gestao.memberships
  for each row execute function proj_hub_gestao.agent_never_writes();
create trigger client_contacts_agent_guard before insert or update or delete on proj_hub_gestao.client_contacts
  for each row execute function proj_hub_gestao.agent_never_writes();
create trigger profiles_agent_guard before insert or update or delete on proj_hub_gestao.profiles
  for each row execute function proj_hub_gestao.agent_never_writes();
create trigger departments_agent_guard before insert or update or delete on proj_hub_gestao.departments
  for each row execute function proj_hub_gestao.agent_never_writes();

-- Agente só muda as colunas listadas em tg_argv (o resto da linha fica como estava).
-- Sem colunas listadas, só leitura. Inserir e apagar são recusados.
create function proj_hub_gestao.agent_updates_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[] := coalesce(tg_argv::text[], '{}'::text[]);
begin
  if proj_hub_gestao.actor_is_agent() then
    if tg_op <> 'UPDATE'
       or (pg_catalog.to_jsonb(new) - allowed) is distinct from (pg_catalog.to_jsonb(old) - allowed)
    then
      raise exception 'agentes não alteram estes dados de %; isso é feito por uma pessoa', tg_table_name
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger agent_api_keys_agent_guard before insert or update or delete on proj_hub_gestao.agent_api_keys
  for each row execute function proj_hub_gestao.agent_updates_only('last_used_at');
create trigger agents_agent_guard before insert or update or delete on proj_hub_gestao.agents
  for each row execute function proj_hub_gestao.agent_updates_only('spent_usd_month', 'updated_at');
create trigger workspaces_agent_guard before insert or update or delete on proj_hub_gestao.workspaces
  for each row execute function proj_hub_gestao.agent_updates_only('task_seq', 'updated_at');

-- Texto e visibilidade para o cliente.
create function proj_hub_gestao.client_text_agent_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not proj_hub_gestao.actor_is_agent() then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'workstreams' then
    if (tg_op = 'INSERT' and (new.visibility <> 'internal' or new.title_client is not null or new.description_client is not null))
       or (tg_op = 'UPDATE' and (new.visibility, new.title_client, new.description_client)
                                is distinct from (old.visibility, old.title_client, old.description_client))
    then
      raise exception 'agentes não mostram frentes ao cliente nem escrevem o texto dele; peça com hub_request_approval'
        using errcode = 'insufficient_privilege';
    end if;
  elsif tg_table_name in ('comments', 'attachments') then
    if tg_op in ('INSERT', 'UPDATE') and new.visibility <> 'internal' then
      raise exception 'agentes só escrevem itens internos; texto para o cliente passa por aprovação'
        using errcode = 'insufficient_privilege';
    end if;
  elsif tg_table_name = 'clients' then
    if (tg_op = 'INSERT' and new.portal_enabled)
       or (tg_op = 'UPDATE' and new.portal_enabled is distinct from old.portal_enabled)
       or tg_op = 'DELETE'
    then
      raise exception 'agentes não liberam o portal nem removem clientes (decisão D9)'
        using errcode = 'insufficient_privilege';
    end if;
  elsif tg_table_name = 'projects' then
    if (tg_op = 'INSERT' and (new.status <> 'in_review' or new.objective_client is not null or new.client_can_confirm_receipt))
       or (tg_op = 'UPDATE' and (new.status, new.objective_client, new.client_can_confirm_receipt, new.require_evidence,
                                 new.archived_at, new.client_id, new.code)
                                is distinct from (old.status, old.objective_client, old.client_can_confirm_receipt,
                                                  old.require_evidence, old.archived_at, old.client_id, old.code))
       or tg_op = 'DELETE'
    then
      raise exception 'agentes só cadastram projeto em revisão e não mudam status, regras nem texto para o cliente'
        using errcode = 'insufficient_privilege';
    end if;
  elsif tg_table_name = 'milestones' then
    if tg_op = 'INSERT' then
      if new.title_client is not null or new.description_client is not null or new.status <> 'planned'
         or not exists (
           select 1 from proj_hub_gestao.projects p
            where p.id = new.project_id and p.status = 'in_review')
      then
        raise exception 'agentes só criam marco em projeto em revisão (importação); novo marco é pedido de aprovação'
          using errcode = 'insufficient_privilege';
      end if;
    elsif tg_op = 'DELETE'
       or (pg_catalog.to_jsonb(new) - array['task_count', 'done_count', 'progress_pct', 'updated_at'])
          is distinct from (pg_catalog.to_jsonb(old) - array['task_count', 'done_count', 'progress_pct', 'updated_at'])
    then
      raise exception 'agentes não alteram marcos; peça com hub_request_approval'
        using errcode = 'insufficient_privilege';
    end if;
  elsif tg_table_name = 'status_reports' then
    if (tg_op = 'INSERT' and new.published_at is not null)
       or (tg_op = 'UPDATE' and (old.published_at is not null or new.published_at is not null))
       or tg_op = 'DELETE'
    then
      raise exception 'agentes não publicam nem alteram relatório publicado; a publicação vem da aprovação'
        using errcode = 'insufficient_privilege';
    end if;
  elsif tg_table_name = 'approvals' then
    if tg_op = 'UPDATE'
       and not (old.status = 'pending' and new.status = 'cancelled'
                and old.requested_by_type = 'agent'
                and old.requested_by_id = proj_hub_gestao.current_actor_id()
                and (pg_catalog.to_jsonb(new) - array['status', 'updated_at'])
                    is not distinct from (pg_catalog.to_jsonb(old) - array['status', 'updated_at']))
    then
      raise exception 'agentes só cancelam o próprio pedido pendente; o resto do pedido não muda'
        using errcode = 'insufficient_privilege';
    elsif tg_op = 'DELETE' then
      raise exception 'agentes não apagam pedidos de aprovação'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger workstreams_client_text_guard before insert or update on proj_hub_gestao.workstreams
  for each row execute function proj_hub_gestao.client_text_agent_guard();
create trigger comments_client_text_guard before insert or update on proj_hub_gestao.comments
  for each row execute function proj_hub_gestao.client_text_agent_guard();
create trigger attachments_client_text_guard before insert or update on proj_hub_gestao.attachments
  for each row execute function proj_hub_gestao.client_text_agent_guard();
create trigger clients_client_text_guard before insert or update or delete on proj_hub_gestao.clients
  for each row execute function proj_hub_gestao.client_text_agent_guard();
create trigger projects_client_text_guard before insert or update or delete on proj_hub_gestao.projects
  for each row execute function proj_hub_gestao.client_text_agent_guard();
create trigger milestones_client_text_guard before insert or update or delete on proj_hub_gestao.milestones
  for each row execute function proj_hub_gestao.client_text_agent_guard();
create trigger status_reports_client_text_guard before insert or update or delete on proj_hub_gestao.status_reports
  for each row execute function proj_hub_gestao.client_text_agent_guard();
create trigger approvals_client_text_guard before update or delete on proj_hub_gestao.approvals
  for each row execute function proj_hub_gestao.client_text_agent_guard();
