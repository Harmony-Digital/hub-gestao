import { authorize } from "@/lib/authorize";
import { notFound } from "@/lib/errors";
import { projectScopeSql } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import type { TaskSummary } from "@/modules/projects/schemas";
import { TASK_SUMMARY_SELECT, toTaskSummary } from "@/modules/projects/service";
import { storedDepartmentViews } from "@/modules/views/service";

/**
 * Visão por departamento (M7): o trabalho de cada departamento cruzando os projetos
 * ativos (fora de revisão e não arquivados), pelas frentes do departamento. A equipe
 * comum vê só os projetos de que participa; dono e administração, todos. Só leitura:
 * mudar uma tarefa continua sendo pelo painel dela, no projeto.
 */

export type DepartmentCard = {
  slug: string;
  name: string;
  color: string;
  lead: string | null;
  open: number;
  inProgress: number;
  blocked: number;
  doneLast7Days: number;
  unassigned: number;
  projects: number;
};

type CardRow = {
  slug: string;
  name: string;
  color: string;
  lead: string | null;
  open: number;
  in_progress: number;
  blocked: number;
  done_7: number;
  unassigned: number;
  projects: number;
};

/** Projetos que contam: ativos (fora de revisão e não arquivados) e no alcance de quem vê. */
function activeProjectSql(t: TxCtx, column: string, params: unknown[]): string {
  return `exists (select 1 from ${S}.projects ap
                   where ap.id = ${column} and ap.status not in ('in_review', 'archived'))
          and ${projectScopeSql(t.actor, column, params)}`;
}

export async function departmentsOverview(t: TxCtx): Promise<DepartmentCard[]> {
  authorize(t.actor, "project.read");
  const params: unknown[] = [];
  const rows = await many<CardRow>(
    t,
    `select d.slug, d.name, d.color, pr.full_name as lead,
            count(tk.id) filter (where tk.status_category <> 'done')::int as open,
            count(tk.id) filter (where tk.status_category = 'in_progress')::int as in_progress,
            count(tk.id) filter (where tk.status_category = 'blocked')::int as blocked,
            count(tk.id) filter (where tk.status_category = 'done'
                                   and tk.completed_at >= now() - interval '7 days')::int as done_7,
            count(tk.id) filter (where tk.status_category <> 'done'
                                   and tk.assignee_id is null)::int as unassigned,
            count(distinct w.project_id)::int as projects
       from ${S}.departments d
       left join ${S}.profiles pr on pr.id = d.lead_profile_id
       left join ${S}.workstreams w
         on w.department_id = d.id and w.archived_at is null
        and ${activeProjectSql(t, "w.project_id", params)}
       left join ${S}.tasks tk on tk.workstream_id = w.id and tk.archived_at is null
      group by d.id, pr.full_name
      order by d.sort_order, d.name`,
    params,
  );
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    color: r.color,
    lead: r.lead,
    open: Number(r.open),
    inProgress: Number(r.in_progress),
    blocked: Number(r.blocked),
    doneLast7Days: Number(r.done_7),
    unassigned: Number(r.unassigned),
    projects: Number(r.projects),
  }));
}

export type DepartmentWorkstream = {
  projectCode: string;
  projectName: string;
  milestone: string | null;
  title: string;
  status: "planned" | "in_progress" | "blocked" | "done";
  progressPct: number;
};

export type AssigneeLoad = {
  key: string;
  name: string;
  agent: boolean;
  open: number;
  inProgress: number;
  blocked: number;
};

export type DepartmentDetail = {
  department: Omit<
    DepartmentCard,
    | "open"
    | "inProgress"
    | "blocked"
    | "doneLast7Days"
    | "unassigned"
    | "projects"
  >;
  /** Abertas e as concluídas nos últimos 7 dias, de todos os projetos ativos. */
  tasks: (TaskSummary & { completed_recently: boolean })[];
  load: AssigneeLoad[];
  workstreams: DepartmentWorkstream[];
  /**
   * A visão padrão do departamento na Lista e no Quadro de cada projeto (RF-23): o
   * endereço guardado por ele ou null (só o filtro do departamento).
   */
  views: { list: string | null; board: string | null };
};

export async function departmentDetail(
  t: TxCtx,
  slug: string,
): Promise<DepartmentDetail> {
  authorize(t.actor, "project.read");
  const d = await maybeOne<{
    id: string;
    slug: string;
    name: string;
    color: string;
    lead: string | null;
  }>(
    t,
    `select d.id, d.slug, d.name, d.color, pr.full_name as lead
       from ${S}.departments d
       left join ${S}.profiles pr on pr.id = d.lead_profile_id
      where d.slug = $1`,
    [slug],
  );
  if (!d) throw notFound("Departamento não encontrado.");

  const taskParams: unknown[] = [d.id];
  const rows = await many<
    Parameters<typeof toTaskSummary>[0] & { completed_recently: boolean }
  >(
    t,
    `${TASK_SUMMARY_SELECT}
       join ${S}.workstreams w on w.id = t.workstream_id
      where w.department_id = $1 and w.archived_at is null and t.archived_at is null
        and ${activeProjectSql(t, "t.project_id", taskParams)}
        and (t.status_category <> 'done' or t.completed_at >= now() - interval '7 days')
      order by t.due_date nulls last, t.created_at
      limit 400`,
    taskParams,
  );
  const tasks = rows.map((r) => ({
    ...toTaskSummary(r),
    completed_recently: r.status_category === "done",
  }));

  const loads = new Map<string, AssigneeLoad>();
  for (const task of tasks) {
    if (!task.assignee || task.status_category === "done") continue;
    const key = `${task.assignee.type}:${task.assignee.id}`;
    const load = loads.get(key) ?? {
      key,
      name: task.assignee.name ?? "Sem nome",
      agent: task.assignee.type === "agent",
      open: 0,
      inProgress: 0,
      blocked: 0,
    };
    load.open += 1;
    if (task.status_category === "in_progress") load.inProgress += 1;
    if (task.status_category === "blocked") load.blocked += 1;
    loads.set(key, load);
  }

  const wsParams: unknown[] = [d.id];
  const workstreams = await many<{
    project_code: string;
    project_name: string;
    milestone: string | null;
    title: string;
    status: DepartmentWorkstream["status"];
    progress_pct: number;
  }>(
    t,
    `select p.code as project_code, p.name as project_name, m.code as milestone,
            w.title, w.status::text as status, w.progress_pct
       from ${S}.workstreams w
       join ${S}.projects p on p.id = w.project_id
       left join ${S}.milestones m on m.id = w.milestone_id
      where w.department_id = $1 and w.archived_at is null
        and ${activeProjectSql(t, "w.project_id", wsParams)}
      order by p.name, m.sort_order nulls last, w.sort_order, w.title`,
    wsParams,
  );

  return {
    department: { slug: d.slug, name: d.name, color: d.color, lead: d.lead },
    views: await storedDepartmentViews(t, d.id),
    tasks,
    load: [...loads.values()].sort(
      (a, b) => b.open - a.open || a.name.localeCompare(b.name, "pt-BR"),
    ),
    workstreams: workstreams.map((w) => ({
      projectCode: w.project_code,
      projectName: w.project_name,
      milestone: w.milestone,
      title: w.title,
      status: w.status,
      progressPct: Number(w.progress_pct),
    })),
  };
}
