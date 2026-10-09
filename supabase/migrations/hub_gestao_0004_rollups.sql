-- Hub de Gestão · 0004 · Progresso e saúde
-- O progresso fica gravado em frente, marco e projeto. Assim o portal mostra o percentual
-- sem o cliente precisar enxergar as tarefas. A saúde é decidida por regra no servidor
-- (código TypeScript testado), a partir da visão de insumos abaixo.

alter table proj_hub_gestao.workstreams
  add column task_count integer not null default 0,
  add column done_count integer not null default 0,
  add column blocked_count integer not null default 0,
  add column progress_pct integer not null default 0 check (progress_pct between 0 and 100);

alter table proj_hub_gestao.milestones
  add column task_count integer not null default 0,
  add column done_count integer not null default 0,
  add column progress_pct integer not null default 0 check (progress_pct between 0 and 100);

alter table proj_hub_gestao.projects
  add column task_count integer not null default 0,
  add column open_task_count integer not null default 0,
  add column blocked_task_count integer not null default 0,
  add column progress_pct integer not null default 0 check (progress_pct between 0 and 100);

-- Recalcula frentes, marcos e o projeto. Considera tarefas de primeiro nível, não arquivadas.
-- Quando todas as tarefas têm estimativa, o progresso é ponderado pelo tempo estimado.
create function proj_hub_gestao.recompute_project_rollup(p_project_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update proj_hub_gestao.workstreams w
     set task_count = s.task_count,
         done_count = s.done_count,
         blocked_count = s.blocked_count,
         progress_pct = s.progress_pct
    from (
      select w2.id,
             count(t.id)::int as task_count,
             (count(t.id) filter (where t.status_category = 'done'))::int as done_count,
             (count(t.id) filter (where t.status_category = 'blocked'))::int as blocked_count,
             case
               when count(t.id) = 0 then 0
               when count(t.estimate_minutes) = count(t.id) and sum(t.estimate_minutes) > 0 then
                 round(100.0 * coalesce(sum(t.estimate_minutes) filter (where t.status_category = 'done'), 0)
                       / sum(t.estimate_minutes))::int
               else round(100.0 * (count(t.id) filter (where t.status_category = 'done')) / count(t.id))::int
             end as progress_pct
        from proj_hub_gestao.workstreams w2
        left join proj_hub_gestao.tasks t
          on t.workstream_id = w2.id and t.archived_at is null and t.parent_task_id is null
       where w2.project_id = p_project_id
       group by w2.id
    ) s
   where w.id = s.id
     and (w.task_count, w.done_count, w.blocked_count, w.progress_pct)
         is distinct from (s.task_count, s.done_count, s.blocked_count, s.progress_pct);

  update proj_hub_gestao.milestones m
     set task_count = s.task_count,
         done_count = s.done_count,
         progress_pct = s.progress_pct
    from (
      select m2.id,
             coalesce(sum(w.task_count), 0)::int as task_count,
             coalesce(sum(w.done_count), 0)::int as done_count,
             case
               when coalesce(sum(w.task_count), 0) = 0 then 0
               else round(100.0 * sum(w.done_count) / sum(w.task_count))::int
             end as progress_pct
        from proj_hub_gestao.milestones m2
        left join proj_hub_gestao.workstreams w
          on w.milestone_id = m2.id and w.archived_at is null
       where m2.project_id = p_project_id
       group by m2.id
    ) s
   where m.id = s.id
     and (m.task_count, m.done_count, m.progress_pct)
         is distinct from (s.task_count, s.done_count, s.progress_pct);

  update proj_hub_gestao.projects p
     set task_count = s.task_count,
         open_task_count = s.open_count,
         blocked_task_count = s.blocked_count,
         progress_pct = s.progress_pct
    from (
      select count(t.id)::int as task_count,
             (count(t.id) filter (where t.status_category <> 'done'))::int as open_count,
             (count(t.id) filter (where t.status_category = 'blocked'))::int as blocked_count,
             case
               when count(t.id) = 0 then 0
               else round(100.0 * (count(t.id) filter (where t.status_category = 'done')) / count(t.id))::int
             end as progress_pct
        from proj_hub_gestao.tasks t
       where t.project_id = p_project_id and t.archived_at is null and t.parent_task_id is null
    ) s
   where p.id = p_project_id
     and (p.task_count, p.open_task_count, p.blocked_task_count, p.progress_pct)
         is distinct from (s.task_count, s.open_count, s.blocked_count, s.progress_pct);
end;
$$;

-- Insumos da regra de saúde (o cálculo em si fica no servidor, testado).
create view proj_hub_gestao.v_project_health_inputs
with (security_invoker = true)
as
select p.id as project_id,
       p.workspace_id,
       p.status,
       p.open_task_count,
       p.blocked_task_count,
       (select count(*)::int
          from proj_hub_gestao.milestones m
         where m.project_id = p.id and m.archived_at is null
           and m.status in ('planned', 'in_progress')
           and m.due_date < current_date) as late_milestones,
       (select min(m.due_date)
          from proj_hub_gestao.milestones m
         where m.project_id = p.id and m.archived_at is null
           and m.status in ('planned', 'in_progress')
           and m.due_date >= current_date) as next_due_date,
       (select min(a.created_at)
          from proj_hub_gestao.approvals a
         where a.project_id = p.id and a.status = 'pending') as oldest_pending_approval_at
  from proj_hub_gestao.projects p
 where p.archived_at is null;

-- Carga por departamento, em todos os projetos.
create view proj_hub_gestao.v_department_load
with (security_invoker = true)
as
select d.id as department_id,
       d.workspace_id,
       d.name,
       (count(t.id) filter (where t.status_category <> 'done'))::int as open_count,
       (count(t.id) filter (where t.status_category = 'in_progress'))::int as in_progress_count,
       (count(t.id) filter (where t.status_category = 'blocked'))::int as blocked_count,
       (count(t.id) filter (where t.status_category = 'done' and t.completed_at >= now() - interval '7 days'))::int as done_last_7_days
  from proj_hub_gestao.departments d
  left join proj_hub_gestao.workstreams w on w.department_id = d.id and w.archived_at is null
  left join proj_hub_gestao.tasks t on t.workstream_id = w.id and t.archived_at is null
 group by d.id;
