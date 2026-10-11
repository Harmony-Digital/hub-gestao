import {
  ACTOR_NAME_SQL,
  authorizeProjectId,
  iso,
  type ActorRef,
  actorRef,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { milestonesOfProject } from "@/modules/milestones/service";
import { dependencyAlertsOf } from "@/modules/workstreams/dependencies";
import type { DependencyAlert } from "@/modules/workstreams/dependency-rule";
import { describeActivity } from "./overview";
import type { HealthDto, MilestoneDto, ProjectDetail } from "./schemas";
import { getProject, getProjectHealth } from "./service";

/**
 * Painel do projeto (M7, RF-22): os números do projeto num lugar só, todos contados em
 * código, sem IA. Saúde pela regra (com os motivos), tarefas por situação, progresso por
 * marco, carga por departamento e por responsável, e o que os agentes fizeram nos
 * últimos 7 dias. Só leitura; quem lê o projeto e as tarefas dele vê o painel.
 */

export type TaskCounts = {
  open: number;
  todo: number;
  inProgress: number;
  review: number;
  blocked: number;
  done: number;
  doneWeek: number;
  late: number;
  dueWeek: number;
  unassigned: number;
};

export type DepartmentLoad = {
  /** null: tarefas sem frente ou de frente sem departamento. */
  slug: string | null;
  name: string;
  color: string | null;
  open: number;
  inProgress: number;
  blocked: number;
  doneWeek: number;
};

export type AssigneeLoad = {
  who: ActorRef;
  open: number;
  inProgress: number;
  blocked: number;
  late: number;
};

export type AgentActivity = {
  id: string;
  name: string;
  actions: number;
  lastAt: string;
};

export type AgentAction = {
  at: string;
  agent: string;
  text: string;
  taskCode: string | null;
};

export type ProjectDashboard = {
  project: ProjectDetail;
  today: string;
  health: HealthDto;
  tasks: TaskCounts;
  milestones: MilestoneDto[];
  departments: DepartmentLoad[];
  assignees: AssigneeLoad[];
  agents: {
    /** Ações dos agentes no projeto nos últimos 7 dias. */
    actionsWeek: number;
    byAgent: AgentActivity[];
    /** As ações mais recentes, de qualquer data. */
    recent: AgentAction[];
  };
  dependencyAlerts: DependencyAlert[];
};

const RECENT_LIMIT = 8;

export async function projectDashboard(
  t: TxCtx,
  code: string,
  now = new Date(),
): Promise<ProjectDashboard> {
  // getProject confere a leitura do projeto; o painel conta tarefas, então exige a delas.
  const project = await getProject(t, code);
  await authorizeProjectId(t, project.id, "task.read");
  const today = (await maybeOne<{ today: string }>(
    t,
    "select current_date::text as today",
  ))!.today;

  const counts = (await maybeOne<{
    open: number;
    todo: number;
    in_progress: number;
    review: number;
    blocked: number;
    done: number;
    done_week: number;
    late: number;
    due_week: number;
    unassigned: number;
  }>(
    t,
    `select count(*) filter (where status_category <> 'done')::int as open,
            count(*) filter (where status_category = 'todo')::int as todo,
            count(*) filter (where status_category = 'in_progress')::int as in_progress,
            count(*) filter (where status_category = 'review')::int as review,
            count(*) filter (where status_category = 'blocked')::int as blocked,
            count(*) filter (where status_category = 'done')::int as done,
            count(*) filter (where status_category = 'done'
                               and completed_at >= now() - interval '7 days')::int as done_week,
            count(*) filter (where status_category <> 'done'
                               and due_date < current_date)::int as late,
            count(*) filter (where status_category <> 'done'
                               and due_date between current_date and current_date + 7)::int as due_week,
            count(*) filter (where status_category <> 'done'
                               and assignee_type is null)::int as unassigned
       from ${S}.tasks
      where project_id = $1 and archived_at is null`,
    [project.id],
  ))!;

  const departments = await many<{
    slug: string | null;
    name: string | null;
    color: string | null;
    open: number;
    in_progress: number;
    blocked: number;
    done_week: number;
  }>(
    t,
    `select d.slug, d.name, d.color,
            count(*) filter (where tk.status_category <> 'done')::int as open,
            count(*) filter (where tk.status_category = 'in_progress')::int as in_progress,
            count(*) filter (where tk.status_category = 'blocked')::int as blocked,
            count(*) filter (where tk.status_category = 'done'
                               and tk.completed_at >= now() - interval '7 days')::int as done_week
       from ${S}.tasks tk
       left join ${S}.workstreams w on w.id = tk.workstream_id
       left join ${S}.departments d on d.id = w.department_id
      where tk.project_id = $1 and tk.archived_at is null
      group by d.slug, d.name, d.color, d.sort_order
      having count(*) filter (where tk.status_category <> 'done') > 0
          or count(*) filter (where tk.status_category = 'done'
                                and tk.completed_at >= now() - interval '7 days') > 0
      order by d.sort_order nulls last, d.name`,
    [project.id],
  );

  const assignees = await many<{
    type: string;
    id: string | null;
    name: string | null;
    open: number;
    in_progress: number;
    blocked: number;
    late: number;
  }>(
    t,
    `select tk.assignee_type::text as type, tk.assignee_id as id,
            ${ACTOR_NAME_SQL("tk.assignee_type::text", "tk.assignee_id")} as name,
            count(*)::int as open,
            count(*) filter (where tk.status_category = 'in_progress')::int as in_progress,
            count(*) filter (where tk.status_category = 'blocked')::int as blocked,
            count(*) filter (where tk.due_date < current_date)::int as late
       from ${S}.tasks tk
      where tk.project_id = $1 and tk.archived_at is null
        and tk.status_category <> 'done' and tk.assignee_type is not null
      group by tk.assignee_type, tk.assignee_id
      order by count(*) desc, 3`,
    [project.id],
  );

  const byAgent = await many<{
    id: string;
    name: string;
    actions: number;
    last_at: Date | string;
  }>(
    t,
    `select ag.id, ag.name, count(*)::int as actions, max(a.created_at) as last_at
       from ${S}.activity_log a
       join ${S}.agents ag on ag.id = a.actor_id
      where a.project_id = $1 and a.actor_type = 'agent'
        and a.created_at > $2::timestamptz - interval '7 days'
      group by ag.id, ag.name
      order by count(*) desc, ag.name`,
    [project.id, now.toISOString()],
  );

  const recent = await many<{
    created_at: Date | string;
    action: string;
    agent: string;
    task_code: string | null;
  }>(
    t,
    `select a.created_at, a.action, ag.name as agent,
            coalesce(tk.code, tkc.code) as task_code
       from ${S}.activity_log a
       join ${S}.agents ag on ag.id = a.actor_id
       left join ${S}.tasks tk on a.entity_type = 'task' and tk.id = a.entity_id
       left join ${S}.comments cm on a.entity_type = 'comment' and cm.id = a.entity_id
       left join ${S}.tasks tkc on cm.entity_type = 'task' and tkc.id = cm.entity_id
      where a.project_id = $1 and a.actor_type = 'agent'
      order by a.id desc
      limit ${RECENT_LIMIT}`,
    [project.id],
  );

  return {
    project,
    today,
    health: await getProjectHealth(t, code, now),
    tasks: {
      open: counts.open,
      todo: counts.todo,
      inProgress: counts.in_progress,
      review: counts.review,
      blocked: counts.blocked,
      done: counts.done,
      doneWeek: counts.done_week,
      late: counts.late,
      dueWeek: counts.due_week,
      unassigned: counts.unassigned,
    },
    milestones: await milestonesOfProject(t, project.id),
    departments: departments.map((d) => ({
      slug: d.slug,
      name: d.name ?? "Sem departamento",
      color: d.color,
      open: d.open,
      inProgress: d.in_progress,
      blocked: d.blocked,
      doneWeek: d.done_week,
    })),
    assignees: assignees.map((a) => ({
      who: actorRef(a.type, a.id, a.name)!,
      open: a.open,
      inProgress: a.in_progress,
      blocked: a.blocked,
      late: a.late,
    })),
    agents: {
      actionsWeek: byAgent.reduce((sum, a) => sum + a.actions, 0),
      byAgent: byAgent.map((a) => ({
        id: a.id,
        name: a.name,
        actions: a.actions,
        lastAt: iso(a.last_at),
      })),
      recent: recent.map((r) => ({
        at: iso(r.created_at),
        agent: r.agent,
        text: describeActivity(r.action, r.task_code),
        taskCode: r.task_code,
      })),
    },
    dependencyAlerts: await dependencyAlertsOf(t, project.id),
  };
}
