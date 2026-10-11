-- Hub de Gestão · 0023 · status da frente derivado das tarefas (RF-12)
--
-- O status da frente passa a sair das tarefas de primeiro nível, não arquivadas, no
-- mesmo recálculo que já grava o andamento (0004), a cada mudança de tarefa:
--   todas concluídas -> Concluída;
--   alguma em andamento ou em revisão -> Em andamento;
--   nenhuma andando e alguma bloqueada -> Bloqueada;
--   alguma concluída e o resto a fazer -> Em andamento;
--   nenhuma começada -> Planejada.
-- Frente sem tarefa fica com o status que a pessoa escolheu. As frentes que já têm
-- tarefa são acertadas no fim desta migração.

create or replace function proj_hub_gestao.recompute_project_rollup(p_project_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update proj_hub_gestao.workstreams w
     set task_count = s.task_count,
         done_count = s.done_count,
         blocked_count = s.blocked_count,
         progress_pct = s.progress_pct,
         status = coalesce(s.derived_status, w.status)
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
             end as progress_pct,
             -- Status derivado das tarefas (RF-12); sem tarefa, fica o que a pessoa escolheu.
             (case
               when count(t.id) = 0 then null
               when count(t.id) filter (where t.status_category = 'done') = count(t.id) then 'done'
               when count(t.id) filter (where t.status_category in ('in_progress', 'review')) > 0 then 'in_progress'
               when count(t.id) filter (where t.status_category = 'blocked') > 0 then 'blocked'
               when count(t.id) filter (where t.status_category = 'done') > 0 then 'in_progress'
               else 'planned'
             end)::proj_hub_gestao.workstream_status as derived_status
        from proj_hub_gestao.workstreams w2
        left join proj_hub_gestao.tasks t
          on t.workstream_id = w2.id and t.archived_at is null and t.parent_task_id is null
       where w2.project_id = p_project_id
       group by w2.id
    ) s
   where w.id = s.id
     and (w.task_count, w.done_count, w.blocked_count, w.progress_pct, w.status)
         is distinct from (s.task_count, s.done_count, s.blocked_count, s.progress_pct,
                           coalesce(s.derived_status, w.status));

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

-- Acerta as frentes que já existem (o recálculo só grava o que mudou).
do $$
declare
  p record;
begin
  for p in select id from proj_hub_gestao.projects loop
    perform proj_hub_gestao.recompute_project_rollup(p.id);
  end loop;
end
$$;
