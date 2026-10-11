-- Hub de Gestão · 0021 · privacidade e retenção (LGPD, M8)
--
-- 1. Contato de cliente com os dados pessoais excluídos (pedido do titular ou fim do
--    contrato): o registro fica, para os vínculos (mensagens, confirmações de entrega),
--    mas com nome e e-mail trocados e a marca anonymized_at. O Hub recusa dar acesso de
--    novo a ele.
-- 2. Retenção: apply_retention() apaga os registros operacionais antigos do workspace de
--    quem chama (o relógio do Hub, uma vez por dia). O histórico (activity_log) não entra:
--    é a trilha de auditoria, só de inserção.

alter table proj_hub_gestao.client_contacts add column anonymized_at timestamptz;

create function proj_hub_gestao.apply_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid := proj_hub_gestao.current_workspace_id();
  v_denials integer;
  v_deliveries integer;
  v_jobs integer;
  v_notifications integer;
  v_sessions integer;
  v_links integer;
begin
  if v_ws is null or not proj_hub_gestao.actor_is_internal() then
    raise exception 'retenção só pela equipe ou pelo próprio Hub'
      using errcode = 'insufficient_privilege';
  end if;

  -- Recusas de acesso dos agentes: 90 dias (a Sala de Controle mostra 30).
  delete from proj_hub_gestao.agent_denials
   where workspace_id = v_ws and created_at < pg_catalog.now() - interval '90 days';
  get diagnostics v_denials = row_count;

  -- Entregas de webhook já resolvidas (entregues ou com as tentativas esgotadas): 30 dias.
  delete from proj_hub_gestao.webhook_deliveries
   where workspace_id = v_ws and created_at < pg_catalog.now() - interval '30 days'
     and (delivered_at is not null or attempts >= 8);
  get diagnostics v_deliveries = row_count;

  -- Jobs: concluídos, 30 dias; com falha, 90 dias.
  delete from proj_hub_gestao.jobs
   where workspace_id = v_ws
     and ((status = 'done' and updated_at < pg_catalog.now() - interval '30 days')
       or (status = 'failed' and updated_at < pg_catalog.now() - interval '90 days'));
  get diagnostics v_jobs = row_count;

  -- Avisos já lidos: 180 dias.
  delete from proj_hub_gestao.notifications
   where workspace_id = v_ws and read_at is not null
     and read_at < pg_catalog.now() - interval '180 days';
  get diagnostics v_notifications = row_count;

  -- Sessões e links do portal encerrados, vencidos ou usados: 90 dias.
  delete from proj_hub_gestao.client_sessions
   where workspace_id = v_ws
     and coalesce(revoked_at, expires_at) < pg_catalog.now() - interval '90 days';
  get diagnostics v_sessions = row_count;

  delete from proj_hub_gestao.client_access_links
   where workspace_id = v_ws
     and coalesce(used_at, expires_at) < pg_catalog.now() - interval '90 days';
  get diagnostics v_links = row_count;

  return pg_catalog.jsonb_build_object(
    'agent_denials', v_denials,
    'webhook_deliveries', v_deliveries,
    'jobs', v_jobs,
    'notifications', v_notifications,
    'client_sessions', v_sessions,
    'client_access_links', v_links);
end;
$$;

revoke all on function proj_hub_gestao.apply_retention() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant execute on function proj_hub_gestao.apply_retention() to hub_gestao_app;
  end if;
end
$$;
