-- Hub de Gestão · 0025 · o contato pede um link novo pelo e-mail (RF-05)
--
-- O contato que o dono já liberou (convidado ou ativo), de cliente com o portal ligado,
-- pede um link novo na entrada do portal, informando o e-mail. O Hub manda um link de uso
-- único, válido por pouco tempo, para o e-mail cadastrado. Quem pede nunca fica sabendo se
-- o e-mail existe (a tela responde sempre o mesmo). Liberar o acesso continua só do dono
-- (D9): contato sem acesso, revogado ou com os dados excluídos não recebe nada.
--
-- Limites: 3 links pedidos por contato por hora e 30 por workspace a cada 10 minutos.
-- O link pedido anula os outros links ainda não usados do contato (um link vivo por vez).
-- Roda antes de existir contexto de ator: função SECURITY DEFINER, com EXECUTE só para o
-- papel do app. O histórico registra o pedido como o próprio Hub, sem o link.

alter table proj_hub_gestao.client_access_links
  drop constraint client_access_links_purpose_check;
alter table proj_hub_gestao.client_access_links
  add constraint client_access_links_purpose_check
    check (purpose in ('invite', 'login', 'request'));

create function proj_hub_gestao.request_client_login_link(
  p_email text,
  p_link_hashes text[],
  p_minutes integer
)
returns table (
  link_index integer,
  contact_email text,
  contact_name text,
  client_name text,
  workspace_name text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_count integer := coalesce(pg_catalog.array_length(p_link_hashes, 1), 0);
  v_index integer := 0;
  r record;
begin
  if v_email is null or v_email = '' or pg_catalog.char_length(v_email) > 254
     or v_count = 0 or p_minutes is null or p_minutes not between 5 and 60 then
    return;
  end if;
  for r in
    select c.id, c.workspace_id, c.name, c.email, cl.name as client, w.name as org
      from proj_hub_gestao.client_contacts c
      join proj_hub_gestao.clients cl on cl.id = c.client_id
      join proj_hub_gestao.workspaces w on w.id = c.workspace_id
     where pg_catalog.lower(c.email) = v_email
       and c.access_status in ('invited', 'active')
       and c.anonymized_at is null
       and c.profile_id is not null
       and cl.portal_enabled
       and cl.archived_at is null
     order by cl.name, c.id
     for update of c
  loop
    v_index := v_index + 1;
    exit when v_index > v_count;
    continue when (
      select pg_catalog.count(*) from proj_hub_gestao.client_access_links l
       where l.contact_id = r.id and l.purpose = 'request'
         and l.created_at > pg_catalog.now() - interval '1 hour') >= 3;
    continue when (
      select pg_catalog.count(*) from proj_hub_gestao.client_access_links l
       where l.workspace_id = r.workspace_id and l.purpose = 'request'
         and l.created_at > pg_catalog.now() - interval '10 minutes') >= 30;
    update proj_hub_gestao.client_access_links
       set expires_at = pg_catalog.now()
     where contact_id = r.id and used_at is null and expires_at > pg_catalog.now();
    insert into proj_hub_gestao.client_access_links
      (workspace_id, contact_id, token_hash, purpose, expires_at)
    values
      (r.workspace_id, r.id, p_link_hashes[v_index], 'request',
       pg_catalog.now() + pg_catalog.make_interval(mins => p_minutes));
    insert into proj_hub_gestao.activity_log
      (workspace_id, actor_type, actor_id, source, action, entity_type, entity_id, after)
    values
      (r.workspace_id, 'system', null, 'ui', 'portal.link_requested', 'client_contact', r.id,
       pg_catalog.jsonb_build_object('name', r.name, 'minutes', p_minutes));
    link_index := v_index;
    contact_email := r.email;
    contact_name := r.name;
    client_name := r.client;
    workspace_name := r.org;
    return next;
  end loop;
end;
$$;

revoke all on function proj_hub_gestao.request_client_login_link(text, text[], integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant execute on function proj_hub_gestao.request_client_login_link(text, text[], integer)
      to hub_gestao_app;
  end if;
end;
$$;
