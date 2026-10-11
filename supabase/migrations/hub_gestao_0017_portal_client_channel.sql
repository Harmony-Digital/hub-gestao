-- Hub de Gestão · 0017 · canal do cliente no portal (PRD §5.2 e §9)
--
-- O contato escreve no canal do projeto pelo portal. A escrita passa por esta função, que
-- confere tudo a partir da sessão (o app não diz quem é o contato): sessão válida, contato
-- com acesso e com o aceite do uso dos dados, cliente com o portal ligado e não
-- arquivado, projeto do cliente fora de revisão e não arquivado, texto de 1 a 4000
-- caracteres e no máximo 20 mensagens por hora por contato. Grava o comentário (no
-- projeto, visível ao cliente, em nome do contato, com acting_role 'client_contact' para
-- a tela saber que veio do cliente) e o registro no histórico, também em nome do contato.
--
-- A resposta da equipe vai pelo caminho de sempre (ator interno, sob a RLS). Agente não
-- escreve no canal do cliente: a trava client_text_agent_guard (0009) recusa.
--
-- Devolve um jsonb com status ('ok', 'no_session', 'not_found', 'invalid' ou
-- 'too_many') e, se ok, os ids do comentário, do projeto e do workspace.

create function proj_hub_gestao.post_client_comment(
  p_session_hash text,
  p_project_code text,
  p_body text
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
  v_project uuid;
  v_recent integer;
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if p_session_hash is null then
    return pg_catalog.jsonb_build_object('status', 'no_session');
  end if;
  select c.id, c.profile_id, c.workspace_id, c.client_id, c.name
    into v_contact, v_profile, v_ws, v_client, v_name
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

  select p.id into v_project
    from proj_hub_gestao.projects p
   where p.workspace_id = v_ws
     and p.client_id = v_client
     and p.code = p_project_code
     and p.status not in ('in_review', 'archived');
  if v_project is null then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;

  if pg_catalog.char_length(v_body) not between 1 and 4000 then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;

  select count(*) into v_recent
    from proj_hub_gestao.comments cm
   where cm.workspace_id = v_ws
     and cm.author_type = 'user'
     and cm.author_id = v_profile
     and cm.acting_role = 'client_contact'
     and cm.created_at > pg_catalog.now() - interval '1 hour';
  if v_recent >= 20 then
    return pg_catalog.jsonb_build_object('status', 'too_many');
  end if;

  insert into proj_hub_gestao.comments
    (workspace_id, project_id, entity_type, entity_id, body_md, visibility,
     author_type, author_id, author_name, acting_role)
  values
    (v_ws, v_project, 'project', v_project, v_body, 'client',
     'user', v_profile, v_name, 'client_contact')
  returning id into v_id;

  insert into proj_hub_gestao.activity_log
    (workspace_id, actor_type, actor_id, acting_role, source, action, entity_type,
     entity_id, project_id, after)
  values
    (v_ws, 'user', v_profile, 'client_contact', 'ui', 'comment.client_posted', 'comment',
     v_id, v_project, pg_catalog.jsonb_build_object('project', p_project_code));

  return pg_catalog.jsonb_build_object(
    'status', 'ok',
    'comment_id', v_id,
    'project_id', v_project,
    'workspace_id', v_ws);
end;
$$;

-- Conta as mensagens recentes do contato sem varrer o canal inteiro.
create index comments_client_author_idx
  on proj_hub_gestao.comments (author_id, created_at)
  where acting_role = 'client_contact';

revoke all on function proj_hub_gestao.post_client_comment(text, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant execute on function proj_hub_gestao.post_client_comment(text, text, text) to hub_gestao_app;
  end if;
end;
$$;
