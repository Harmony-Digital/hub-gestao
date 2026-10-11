import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { FORECAST_WINDOW_DAYS, type ForecastInputs } from "./rule";

/**
 * O que a deriva prevista precisa (PRD §5.7), lido do banco no fuso do workspace: as
 * tarefas de primeiro nível concluídas nos últimos 14 dias e, para cada marco ainda no
 * prazo (planejado ou em andamento, com data de hoje em diante), a folga em dias e as
 * tarefas abertas das frentes ativas dele.
 */
export async function forecastInputsOf(
  t: TxCtx,
  projectId: string,
): Promise<ForecastInputs> {
  const done = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.tasks
      where project_id = $1 and archived_at is null and parent_task_id is null
        and status_category = 'done'
        and completed_at >= now() - make_interval(days => $2)`,
    [projectId, FORECAST_WINDOW_DAYS],
  );
  const upcoming = await many<{
    code: string;
    slack_days: number;
    remaining: number;
  }>(
    t,
    `select m.code, (m.due_date - current_date)::int as slack_days,
            (select count(*)::int from ${S}.tasks tk
               join ${S}.workstreams w on w.id = tk.workstream_id
              where w.milestone_id = m.id and w.archived_at is null
                and tk.archived_at is null and tk.parent_task_id is null
                and tk.status_category <> 'done') as remaining
       from ${S}.milestones m
      where m.project_id = $1 and m.archived_at is null
        and m.status in ('planned', 'in_progress')
        and m.due_date >= current_date
      order by m.due_date, m.sort_order`,
    [projectId],
  );
  return { done_recent: done?.n ?? 0, upcoming };
}
