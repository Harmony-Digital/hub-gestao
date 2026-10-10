-- Hub de Gestão · 0018 · o cliente confirma o recebimento de uma entrega (D9)
--
-- Opção por projeto (projects.client_can_confirm_receipt, desligada por padrão): o
-- contato decisor (client_approver) confirma no portal que recebeu uma entrega já
-- entregue. Não é o aceite do marco, que continua do dono (D9): é só o registro de que
-- o cliente recebeu. A confirmação passa por esta função, que confere tudo a partir da
-- sessão: sessão válida, contato decisor com acesso e com o aceite do uso dos dados,
-- projeto do cliente com a opção ligada, marco visível ao cliente (marcado para ele, com
-- o título para ele, não arquivado), entregue ou aceito, e ainda sem confirmação. Grava
-- quando e quem (o nome do contato fica no marco, porque a equipe não lê o perfil de quem
-- é só contato) e o registro no histórico, em nome do contato.
--
-- Devolve um jsonb com status ('ok', 'no_session', 'not_allowed', 'not_found' ou
-- 'already') e, se ok, os ids do marco, do projeto e do workspace.

alter table proj_hub_gestao.milestones
  add column client_received_at timestamptz,
  add column client_received_by_profile_id uuid
    references proj_hub_gestao.profiles(id) on delete set null,
  add column client_received_by_name text
    check (client_received_by_name is null or char_length(client_received_by_name) <= 120);

create index milestones_client_received_by_idx
  on proj_hub_gestao.milestones (client_received_by_profile_id);

create function proj_hub_gestao.confirm_milestone_receipt(
  p_session_hash text,
  p_project_code text,
  p_milestone_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
  v_profile uuid;
  v_ws uuid;
  v_client uuid;
  v_name text;
  v_role text;
  v_project uuid;
  v_allowed boolean;
  v_status text;
  v_received timestamptz;
begin
  if p_session_hash is null or p_milestone_id is null then
    return pg_catalog.jsonb_build_object('status', 'no_session');
  end if;
  select c.id, c.profile_id, c.workspace_id, c.client_id, c.name, c.role::text
    into v_contact, v_profile, v_ws, v_client, v_name, v_role
    from proj_hub_gestao.client_sessions s
    join proj_hub_gestao.client_contacts c on c.id = s.contact_id
    join proj_hub_gestao.clients cl on cl.id = c.client_id
   where s.token_hash = p_session_hash
     and s.revoked_at is null
     and s.expires_at > pg_catalog.now()
     and c.access_status = 'active'
     and c.profile_id is not null
     and c.consent_at is not null
     and cl.portal_enabled
     and cl.archived_at is null;
  if v_contact is null then
    return pg_catalog.jsonb_build_object('status', 'no_session');
  end if;

  select p.id, p.client_can_confirm_receipt into v_project, v_allowed
    from proj_hub_gestao.projects p
   where p.workspace_id = v_ws
     and p.client_id = v_client
     and p.code = p_project_code
     and p.status not in ('in_review', 'archived');
  if v_project is null then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  if not v_allowed or v_role <> 'client_approver' then
    return pg_catalog.jsonb_build_object('status', 'not_allowed');
  end if;

  select m.status::text, m.client_received_at into v_status, v_received
    from proj_hub_gestao.milestones m
   where m.id = p_milestone_id
     and m.project_id = v_project
     and m.visibility = 'client'
     and m.title_client is not null
     and m.archived_at is null
   for update;
  if v_status is null or v_status not in ('delivered', 'accepted') then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  if v_received is not null then
    return pg_catalog.jsonb_build_object('status', 'already');
  end if;

  update proj_hub_gestao.milestones
     set client_received_at = pg_catalog.now(),
         client_received_by_profile_id = v_profile,
         client_received_by_name = v_name
   where id = p_milestone_id;

  insert into proj_hub_gestao.activity_log
    (workspace_id, actor_type, actor_id, acting_role, source, action, entity_type,
     entity_id, project_id, after)
  values
    (v_ws, 'user', v_profile, 'client_contact', 'ui', 'milestone.receipt_confirmed',
     'milestone', p_milestone_id, v_project,
     pg_catalog.jsonb_build_object('project', p_project_code));

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'milestone_id', p_milestone_id,
    'project_id', v_project,
    'workspace_id', v_ws);
end;
$$;

revoke all on function proj_hub_gestao.confirm_milestone_receipt(text, text, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant execute on function proj_hub_gestao.confirm_milestone_receipt(text, text, uuid) to hub_gestao_app;
  end if;
end;
$$;
