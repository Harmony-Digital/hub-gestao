-- Hub de Gestão · 0027 · prazos de retenção configuráveis (PRD §12)
--
-- apply_retention() (0021) passa a ler os prazos, em dias, de workspaces.settings ->
-- 'retention', com o padrão de antes e limites de mínimo e máximo (valor fora do formato
-- ou da faixa vira o limite mais perto, ou o padrão). Entra também o registro das
-- chamadas de IA (agent_runs): 365 dias, os 12 meses do PRD. O histórico (activity_log)
-- continua fora: é a trilha de auditoria, só de inserção. Quem muda os prazos é o dono,
-- em Configurações; o Hub roda a retenção uma vez por dia (job retention).

create or replace function proj_hub_gestao.retention_days(
  p_settings jsonb,
  p_key text,
  p_default integer,
  p_min integer,
  p_max integer
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_settings -> 'retention' ->> p_key ~ '^[0-9]{1,5}$'
      then least(greatest((p_settings -> 'retention' ->> p_key)::integer, p_min), p_max)
    else p_default
  end
$$;

create or replace function proj_hub_gestao.apply_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := proj_hub_gestao.current_workspace_id();
  v_settings jsonb;
  v_denials integer;
  v_deliveries integer;
  v_jobs integer;
  v_notifications integer;
  v_sessions integer;
  v_links integer;
  v_runs integer;
begin
  if v_ws is null or not proj_hub_gestao.actor_is_internal() then
    raise exception 'retenção só pela equipe ou pelo próprio Hub'
      using errcode = 'insufficient_privilege';
  end if;
  select w.settings into v_settings from proj_hub_gestao.workspaces w where w.id = v_ws;
  v_settings := coalesce(v_settings, '{}'::jsonb);

  -- Recusas de acesso dos agentes (padrão 90 dias; a Sala de Controle mostra 30).
  delete from proj_hub_gestao.agent_denials
   where workspace_id = v_ws
     and created_at < pg_catalog.now() - pg_catalog.make_interval(
           days => proj_hub_gestao.retention_days(v_settings, 'agent_denials', 90, 30, 365));
  get diagnostics v_denials = row_count;

  -- Entregas de webhook já resolvidas (entregues ou com as tentativas esgotadas): 30 dias.
  delete from proj_hub_gestao.webhook_deliveries
   where workspace_id = v_ws
     and created_at < pg_catalog.now() - pg_catalog.make_interval(
           days => proj_hub_gestao.retention_days(v_settings, 'webhook_deliveries', 30, 7, 365))
     and (delivered_at is not null or attempts >= 8);
  get diagnostics v_deliveries = row_count;

  -- Jobs: concluídos, 30 dias; com falha, 90 dias.
  delete from proj_hub_gestao.jobs
   where workspace_id = v_ws
     and ((status = 'done' and updated_at < pg_catalog.now() - pg_catalog.make_interval(
             days => proj_hub_gestao.retention_days(v_settings, 'jobs_done', 30, 7, 365)))
       or (status = 'failed' and updated_at < pg_catalog.now() - pg_catalog.make_interval(
             days => proj_hub_gestao.retention_days(v_settings, 'jobs_failed', 90, 30, 365))));
  get diagnostics v_jobs = row_count;

  -- Avisos já lidos: 180 dias.
  delete from proj_hub_gestao.notifications
   where workspace_id = v_ws and read_at is not null
     and read_at < pg_catalog.now() - pg_catalog.make_interval(
           days => proj_hub_gestao.retention_days(v_settings, 'notifications_read', 180, 30, 730));
  get diagnostics v_notifications = row_count;

  -- Sessões e links do portal encerrados, vencidos ou usados: 90 dias.
  delete from proj_hub_gestao.client_sessions
   where workspace_id = v_ws
     and coalesce(revoked_at, expires_at) < pg_catalog.now() - pg_catalog.make_interval(
           days => proj_hub_gestao.retention_days(v_settings, 'portal_sessions', 90, 30, 365));
  get diagnostics v_sessions = row_count;

  delete from proj_hub_gestao.client_access_links
   where workspace_id = v_ws
     and coalesce(used_at, expires_at) < pg_catalog.now() - pg_catalog.make_interval(
           days => proj_hub_gestao.retention_days(v_settings, 'portal_sessions', 90, 30, 365));
  get diagnostics v_links = row_count;

  -- Chamadas de IA dos agentes (custo e modelo de cada uma): 365 dias.
  delete from proj_hub_gestao.agent_runs
   where workspace_id = v_ws
     and started_at < pg_catalog.now() - pg_catalog.make_interval(
           days => proj_hub_gestao.retention_days(v_settings, 'agent_runs', 365, 90, 1095));
  get diagnostics v_runs = row_count;

  return pg_catalog.jsonb_build_object(
    'agent_denials', v_denials,
    'webhook_deliveries', v_deliveries,
    'jobs', v_jobs,
    'notifications', v_notifications,
    'client_sessions', v_sessions,
    'client_access_links', v_links,
    'agent_runs', v_runs);
end;
$$;

revoke all on function proj_hub_gestao.retention_days(jsonb, text, integer, integer, integer) from public;
revoke all on function proj_hub_gestao.apply_retention() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant execute on function proj_hub_gestao.retention_days(jsonb, text, integer, integer, integer) to hub_gestao_app;
    grant execute on function proj_hub_gestao.apply_retention() to hub_gestao_app;
  end if;
end
$$;
