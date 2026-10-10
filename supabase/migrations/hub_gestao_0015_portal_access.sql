-- Hub de Gestão · 0015 · acesso do cliente ao portal (D9)
--
-- O contato de cliente entra no portal por um link de uso único que só o dono gera
-- ("Liberar acesso" e "Gerar novo link", na tela do cliente), e ganha uma sessão curta
-- do próprio Hub. Não existe conta no Supabase Auth para cliente: o Auth compartilhado
-- da Harmony tem cadastro fechado e o Hub não guarda a chave de administração dele.
--
-- Regras:
--   * No banco ficam só os hashes (HMAC com o pepper do servidor) do link e da sessão;
--     o valor em claro aparece uma vez, para o dono copiar, ou vai no cookie da sessão.
--   * Link vence (em 7 dias) e vale uma vez. Sessão é curta: vence depois de 12 horas
--     sem uso (cada uso renova, até 7 dias desde a entrada) e é revogável; revogar o
--     acesso do contato encerra as sessões e anula os links pendentes.
--   * Só entra contato com acesso liberado ('invited' ou 'active'), de cliente com o
--     portal ligado e não arquivado, e com perfil (o id do ator no portal).
--   * Agente nunca escreve nestas tabelas (D9: liberar acesso é do dono).
--   * Resgatar o link e ler a sessão acontecem antes de existir contexto de ator: são
--     funções SECURITY DEFINER, sem passe livre para mais nada, com EXECUTE só para o
--     papel do app.

create table proj_hub_gestao.client_access_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  contact_id uuid not null references proj_hub_gestao.client_contacts(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) between 32 and 200),
  purpose text not null check (purpose in ('invite', 'login')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by_profile_id uuid references proj_hub_gestao.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index client_access_links_contact_idx
  on proj_hub_gestao.client_access_links (contact_id);
create index client_access_links_workspace_idx
  on proj_hub_gestao.client_access_links (workspace_id);
create index client_access_links_created_by_idx
  on proj_hub_gestao.client_access_links (created_by_profile_id);

create table proj_hub_gestao.client_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references proj_hub_gestao.workspaces(id) on delete restrict,
  contact_id uuid not null references proj_hub_gestao.client_contacts(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) between 32 and 200),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index client_sessions_contact_idx
  on proj_hub_gestao.client_sessions (contact_id);
create index client_sessions_workspace_idx
  on proj_hub_gestao.client_sessions (workspace_id);

alter table proj_hub_gestao.client_access_links enable row level security;
alter table proj_hub_gestao.client_sessions enable row level security;

-- Só a equipe enxerga (e o serviço só deixa o dono mexer); o cliente nunca lê.
create policy client_access_links_internal on proj_hub_gestao.client_access_links for all
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );
create policy client_sessions_internal on proj_hub_gestao.client_sessions for all
  using (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  )
  with check (
    (select proj_hub_gestao.actor_is_internal())
    and workspace_id = (select proj_hub_gestao.current_workspace_id())
  );

create trigger client_access_links_agent_guard
  before insert or update or delete on proj_hub_gestao.client_access_links
  for each row execute function proj_hub_gestao.agent_never_writes();
create trigger client_sessions_agent_guard
  before insert or update or delete on proj_hub_gestao.client_sessions
  for each row execute function proj_hub_gestao.agent_never_writes();

-- Resgata o link: marca o uso, ativa o contato (se era convite) e abre a sessão.
-- Devolve o slug do cliente; link inválido, vencido, usado ou de contato sem acesso:
-- nada volta (e nada muda).
create function proj_hub_gestao.redeem_client_access_link(
  p_link_hash text,
  p_session_hash text,
  p_session_hours integer
)
returns table (client_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link_id uuid;
  v_contact_id uuid;
  v_ws uuid;
  v_expires timestamptz;
  v_used timestamptz;
  v_profile uuid;
  v_status proj_hub_gestao.access_status;
  v_slug text;
  v_portal boolean;
  v_archived timestamptz;
begin
  if p_link_hash is null or p_session_hash is null
     or p_session_hours is null or p_session_hours not between 1 and 24 then
    return;
  end if;

  select l.id, l.contact_id, l.workspace_id, l.expires_at, l.used_at
    into v_link_id, v_contact_id, v_ws, v_expires, v_used
    from proj_hub_gestao.client_access_links l
   where l.token_hash = p_link_hash
   for update;
  if v_link_id is null or v_used is not null or v_expires <= pg_catalog.now() then
    return;
  end if;

  select c.profile_id, c.access_status, cl.slug, cl.portal_enabled, cl.archived_at
    into v_profile, v_status, v_slug, v_portal, v_archived
    from proj_hub_gestao.client_contacts c
    join proj_hub_gestao.clients cl on cl.id = c.client_id
   where c.id = v_contact_id;
  if v_profile is null or v_status not in ('invited', 'active')
     or not coalesce(v_portal, false) or v_archived is not null then
    return;
  end if;

  update proj_hub_gestao.client_access_links
     set used_at = pg_catalog.now()
   where id = v_link_id;
  update proj_hub_gestao.client_contacts
     set access_status = 'active'
   where id = v_contact_id and access_status = 'invited';
  insert into proj_hub_gestao.client_sessions (workspace_id, contact_id, token_hash, expires_at)
  values (v_ws, v_contact_id, p_session_hash,
          pg_catalog.now() + pg_catalog.make_interval(hours => p_session_hours));
  insert into proj_hub_gestao.activity_log
    (workspace_id, actor_type, actor_id, source, action, entity_type, entity_id, after)
  values
    (v_ws, 'user', v_profile, 'ui', 'portal.signed_in', 'client_contact', v_contact_id,
     pg_catalog.jsonb_build_object('client', v_slug));
  return query select v_slug;
end;
$$;

-- Quem é o contato desta sessão (só sessão válida de contato com acesso, de cliente com
-- o portal ligado). A sessão é curta e desliza: cada uso empurra o fim para 12 horas
-- depois, até no máximo 7 dias desde a entrada; parada por 12 horas, vence. O último
-- acesso (e o fim) é atualizado no máximo a cada 5 minutos.
create function proj_hub_gestao.client_for_portal_session(p_session_hash text)
returns table (
  workspace_id uuid,
  contact_id uuid,
  profile_id uuid,
  client_id uuid,
  client_slug text,
  client_name text,
  contact_name text,
  contact_role text,
  consent_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_seen timestamptz;
begin
  if p_session_hash is null then
    return;
  end if;
  select s.id, s.last_seen_at into v_session, v_seen
    from proj_hub_gestao.client_sessions s
   where s.token_hash = p_session_hash
     and s.revoked_at is null
     and s.expires_at > pg_catalog.now();
  if v_session is null then
    return;
  end if;
  if v_seen is null or v_seen < pg_catalog.now() - interval '5 minutes' then
    update proj_hub_gestao.client_sessions
       set last_seen_at = pg_catalog.now(),
           expires_at = greatest(
             expires_at,
             least(created_at + interval '7 days', pg_catalog.now() + interval '12 hours'))
     where id = v_session;
  end if;
  return query
    select c.workspace_id, c.id, c.profile_id, c.client_id, cl.slug, cl.name, c.name,
           c.role, c.consent_at
      from proj_hub_gestao.client_sessions s
      join proj_hub_gestao.client_contacts c on c.id = s.contact_id
      join proj_hub_gestao.clients cl on cl.id = c.client_id
     where s.id = v_session
       and c.access_status = 'active'
       and c.profile_id is not null
       and cl.portal_enabled
       and cl.archived_at is null;
end;
$$;

-- Consentimento LGPD no primeiro acesso (PRD §12): registra a data, uma vez.
create function proj_hub_gestao.record_client_consent(p_session_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
  v_profile uuid;
  v_ws uuid;
begin
  select c.id, c.profile_id, c.workspace_id into v_contact, v_profile, v_ws
    from proj_hub_gestao.client_sessions s
    join proj_hub_gestao.client_contacts c on c.id = s.contact_id
   where s.token_hash = p_session_hash
     and s.revoked_at is null
     and s.expires_at > pg_catalog.now()
     and c.access_status = 'active';
  if v_contact is null then
    return false;
  end if;
  update proj_hub_gestao.client_contacts
     set consent_at = pg_catalog.now()
   where id = v_contact and consent_at is null;
  if found then
    insert into proj_hub_gestao.activity_log
      (workspace_id, actor_type, actor_id, source, action, entity_type, entity_id)
    values (v_ws, 'user', v_profile, 'ui', 'portal.consent_given', 'client_contact', v_contact);
  end if;
  return true;
end;
$$;

-- Sair: encerra a sessão.
create function proj_hub_gestao.end_client_session(p_session_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  update proj_hub_gestao.client_sessions
     set revoked_at = pg_catalog.now()
   where token_hash = p_session_hash and revoked_at is null
$$;

revoke all on function proj_hub_gestao.redeem_client_access_link(text, text, integer) from public;
revoke all on function proj_hub_gestao.client_for_portal_session(text) from public;
revoke all on function proj_hub_gestao.record_client_consent(text) from public;
revoke all on function proj_hub_gestao.end_client_session(text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant select, insert, update on proj_hub_gestao.client_access_links to hub_gestao_app;
    grant select, insert, update on proj_hub_gestao.client_sessions to hub_gestao_app;
    grant execute on function proj_hub_gestao.redeem_client_access_link(text, text, integer) to hub_gestao_app;
    grant execute on function proj_hub_gestao.client_for_portal_session(text) to hub_gestao_app;
    grant execute on function proj_hub_gestao.record_client_consent(text) to hub_gestao_app;
    grant execute on function proj_hub_gestao.end_client_session(text) to hub_gestao_app;
  end if;
end;
$$;
