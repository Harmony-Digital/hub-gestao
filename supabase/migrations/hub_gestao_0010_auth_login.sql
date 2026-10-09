-- Hub de Gestão · 0010 · login da equipe (Supabase Auth)
--
-- O login é do Supabase Auth compartilhado (GoTrue), com cadastro aberto desligado: só
-- existe usuário que o Fábio criou lá. O servidor do Hub confere a sessão no próprio
-- GoTrue e, com o usuário já verificado, pergunta a esta função quem ele é no Hub.
--
-- Regras:
--   * Entra quem tem perfil ativo E vínculo ativo com o workspace. Sem isso, nada volta.
--   * No primeiro login, o usuário do GoTrue é ligado ao perfil pelo e-mail, e só se o
--     e-mail estiver confirmado no GoTrue e o perfil ainda não tiver login. Depois disso,
--     vale só o vínculo (auth_user_id); trocar o e-mail no GoTrue não troca o perfil.
--   * O vínculo é registrado no histórico (activity_log), em nome da própria pessoa.
--   * Contatos de cliente (portal, D9) não entram por aqui: só vínculo da equipe.
--
-- Roda antes de existir contexto de ator, por isso é SECURITY DEFINER e devolve só o
-- mínimo. Ninguém executa por padrão; o papel do app recebe EXECUTE explicitamente.

create function proj_hub_gestao.profile_for_auth_user(
  p_auth_user_id uuid,
  p_email text,
  p_email_confirmed boolean,
  p_workspace_slug text
)
returns table (
  profile_id uuid,
  full_name text,
  email text,
  workspace_id uuid,
  role proj_hub_gestao.workspace_role,
  linked_now boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_profile_id uuid;
  v_deactivated timestamptz;
  v_linked boolean := false;
begin
  if p_auth_user_id is null or p_workspace_slug is null then
    return;
  end if;

  select w.id into v_ws from proj_hub_gestao.workspaces w where w.slug = p_workspace_slug;
  if v_ws is null then
    return;
  end if;

  select p.id, p.deactivated_at into v_profile_id, v_deactivated
    from proj_hub_gestao.profiles p
   where p.auth_user_id = p_auth_user_id;

  if v_profile_id is null then
    if not coalesce(p_email_confirmed, false)
       or p_email is null
       or char_length(btrim(p_email)) not between 3 and 254 then
      return;
    end if;

    select p.id into v_profile_id
      from proj_hub_gestao.profiles p
     where lower(p.email) = lower(btrim(p_email))
       and p.auth_user_id is null
       and p.deactivated_at is null
       and exists (
         select 1 from proj_hub_gestao.memberships m
          where m.profile_id = p.id and m.workspace_id = v_ws and m.status = 'active'
       )
     for update;
    if v_profile_id is null then
      return;
    end if;

    update proj_hub_gestao.profiles
       set auth_user_id = p_auth_user_id
     where id = v_profile_id;

    insert into proj_hub_gestao.activity_log
      (workspace_id, actor_type, actor_id, source, action, entity_type, entity_id, after)
    values
      (v_ws, 'user', v_profile_id, 'ui', 'profile.login_linked', 'profile', v_profile_id,
       jsonb_build_object('auth_user_id', p_auth_user_id));
    v_linked := true;
  elsif v_deactivated is not null then
    return;
  end if;

  return query
    select p.id, p.full_name, p.email, m.workspace_id, m.role, v_linked
      from proj_hub_gestao.profiles p
      join proj_hub_gestao.memberships m
        on m.profile_id = p.id and m.workspace_id = v_ws and m.status = 'active'
     where p.id = v_profile_id;
end;
$$;
revoke all on function proj_hub_gestao.profile_for_auth_user(uuid, text, boolean, text) from public;
