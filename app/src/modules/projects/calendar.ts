import { ACTOR_NAME_SQL, authorizeProjectId } from "@/modules/common";
import { many, maybeOne, type TxCtx, S } from "@/modules/context";
import type { StatusCategory } from "@/modules/tasks/status-categories";
import type { MilestoneDto, ProjectDetail } from "./schemas";
import { getProject } from "./service";

/**
 * Calendário do projeto (M7): as entregas (marcos, pela data vigente) e os prazos das
 * tarefas, entre duas datas (a grade do mês). Só leitura; mudar continua pelo marco ou
 * pelo painel da tarefa.
 */

export type CalendarEntry =
  | {
      kind: "milestone";
      date: string;
      code: string;
      title: string;
      status: MilestoneDto["status"];
      internal: boolean;
    }
  | {
      kind: "task";
      date: string;
      code: string;
      title: string;
      category: StatusCategory;
      assignee: string | null;
    };

export type ProjectCalendar = {
  project: ProjectDetail;
  /** Hoje no fuso do workspace (AAAA-MM-DD). */
  today: string;
  entries: CalendarEntry[];
};

export async function projectCalendar(
  t: TxCtx,
  code: string,
  range: { from: string; to: string },
): Promise<ProjectCalendar> {
  const project = await getProject(t, code);
  await authorizeProjectId(t, project.id, "task.read");
  const today = (await maybeOne<{ today: string }>(
    t,
    "select current_date::text as today",
  ))!.today;
  const milestones = await many<{
    code: string;
    title: string;
    status: MilestoneDto["status"];
    due_date: string;
    visibility: string;
  }>(
    t,
    `select code, title, status::text as status, due_date::text as due_date,
            visibility::text as visibility
       from ${S}.milestones
      where project_id = $1 and archived_at is null
        and due_date between $2::date and $3::date
      order by due_date, sort_order, code`,
    [project.id, range.from, range.to],
  );
  const tasks = await many<{
    code: string;
    title: string;
    status_category: StatusCategory;
    due_date: string;
    assignee: string | null;
  }>(
    t,
    `select t.code, t.title, t.status_category::text as status_category,
            t.due_date::text as due_date,
            ${ACTOR_NAME_SQL("t.assignee_type", "t.assignee_id")} as assignee
       from ${S}.tasks t
      where t.project_id = $1 and t.archived_at is null
        and t.due_date between $2::date and $3::date
      order by t.due_date, t.status_category = 'done', t.code
      limit 500`,
    [project.id, range.from, range.to],
  );
  return {
    project,
    today,
    entries: [
      ...milestones.map((m): CalendarEntry => ({
        kind: "milestone",
        date: m.due_date,
        code: m.code,
        title: m.title,
        status: m.status,
        internal: m.visibility === "internal",
      })),
      ...tasks.map((k): CalendarEntry => ({
        kind: "task",
        date: k.due_date,
        code: k.code,
        title: k.title,
        category: k.status_category,
        assignee: k.assignee,
      })),
    ],
  };
}
