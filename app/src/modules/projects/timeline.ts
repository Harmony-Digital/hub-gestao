import { authorizeProjectId } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import type { ProjectDetail } from "./schemas";
import { getProject } from "./service";
import {
  buildTimeline,
  type Timeline,
  type TimelineMilestoneIn,
  type TimelineWorkstreamIn,
} from "./timeline-layout";

/**
 * Linha do tempo do projeto (M7): marcos e frentes em barras. A data de cada frente sai
 * das tarefas dela (início ou criação, prazo ou conclusão); sem tarefas datadas, a frente
 * segue o marco. As dependências entre frentes aparecem com alerta quando a frente de que
 * outra depende termina depois de ela começar. Datas de instantes viram dia no fuso do
 * workspace (o da sessão, ajustado em cada transação). Só leitura.
 */
export async function projectTimeline(
  t: TxCtx,
  code: string,
): Promise<{ project: ProjectDetail; today: string; timeline: Timeline }> {
  const project = await getProject(t, code);
  await authorizeProjectId(t, project.id, "task.read");
  const today = (await maybeOne<{ today: string }>(
    t,
    "select current_date::text as today",
  ))!.today;
  const milestones = await many<{
    id: string;
    code: string;
    title: string;
    status: TimelineMilestoneIn["status"];
    due_date: string | null;
    delivered_on: string | null;
    progress_pct: number;
  }>(
    t,
    `select id, code, title, status::text as status, due_date::text as due_date,
            coalesce(delivered_at, accepted_at)::date::text
              as delivered_on,
            progress_pct
       from ${S}.milestones
      where project_id = $1 and archived_at is null
      order by sort_order, code`,
    [project.id],
  );
  const workstreams = await many<{
    id: string;
    milestone_id: string | null;
    title: string;
    status: TimelineWorkstreamIn["status"];
    progress_pct: number;
    first_day: string | null;
    last_day: string | null;
    depends_on: string[] | null;
  }>(
    t,
    `select w.id, w.milestone_id, w.title, w.status::text as status, w.progress_pct,
            (select min(coalesce(tk.start_date,
                                 tk.created_at::date))::text
               from ${S}.tasks tk
              where tk.workstream_id = w.id and tk.archived_at is null) as first_day,
            (select max(coalesce(tk.due_date,
                                 tk.completed_at::date))::text
               from ${S}.tasks tk
              where tk.workstream_id = w.id and tk.archived_at is null) as last_day,
            (select array_agg(d.depends_on_id::text)
               from ${S}.workstream_dependencies d
              where d.workstream_id = w.id) as depends_on
       from ${S}.workstreams w
      where w.project_id = $1 and w.archived_at is null
      order by w.sort_order, w.created_at`,
    [project.id],
  );
  return {
    project,
    today,
    timeline: buildTimeline({
      today,
      projectStart: project.start_date,
      projectEnd: project.target_date,
      milestones: milestones.map((m) => ({
        id: m.id,
        code: m.code,
        title: m.title,
        status: m.status,
        dueDate: m.due_date,
        deliveredOn: m.delivered_on,
        progressPct: Number(m.progress_pct),
      })),
      workstreams: workstreams.map((w) => ({
        id: w.id,
        milestoneId: w.milestone_id,
        title: w.title,
        status: w.status,
        progressPct: Number(w.progress_pct),
        firstDay: w.first_day,
        lastDay: w.last_day,
        dependsOn: w.depends_on ?? [],
      })),
    }),
  };
}
