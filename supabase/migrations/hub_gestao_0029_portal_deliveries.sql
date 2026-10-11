-- Hub de Gestão · 0029 · andamento do portal pelas entregas
--
-- O andamento que o cliente vê nunca fica abaixo da fatia de entregas concluídas
-- (modules/portal/progress.ts). A fatia conta todos os marcos do projeto, inclusive os
-- internos: só com os que o cliente enxerga, um projeto com 1 marco visível e entregue
-- apareceria com 100%. O cliente recebe só as duas contagens, por esta função, e só de
-- projeto dele que não esteja em revisão nem arquivado; títulos e status dos marcos
-- internos continuam fora do alcance dele.

create function proj_hub_gestao.client_project_deliveries(p_project_ids uuid[])
returns table (project_id uuid, delivered integer, total integer)
language sql
stable
security definer
set search_path = ''
as $$
  select m.project_id,
         (count(*) filter (where m.status in ('delivered', 'accepted')))::integer,
         count(*)::integer
    from proj_hub_gestao.milestones m
   where m.project_id = any(p_project_ids)
     and m.archived_at is null
     and proj_hub_gestao.project_visible_to_client(m.project_id)
   group by m.project_id
$$;

revoke all on function proj_hub_gestao.client_project_deliveries(uuid[]) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'hub_gestao_app') then
    grant execute on function proj_hub_gestao.client_project_deliveries(uuid[]) to hub_gestao_app;
  end if;
end;
$$;
