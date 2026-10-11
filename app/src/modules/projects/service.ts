import { authorize, type Action } from "@/lib/authorize";
import {
  ACTOR_NAME_SQL,
  actorRef,
  iso,
  isoOrNull,
  projectScopeSql,
  resolveProject,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { forecastInputsOf } from "@/modules/health/forecast";
import { computeHealth, driftForecast } from "@/modules/health/rule";
import { dependencyAlertsOf } from "@/modules/workstreams/dependencies";
import { milestonesOfProject } from "@/modules/milestones/service";
import type {
  HealthDto,
  PlanDto,
  ProjectDetail,
  ProjectSummary,
  TaskSummary,
} from "@/modules/projects/schemas";
import { workstreamsOfProject } from "@/modules/workstreams/service";

const PROJECT_SELECT = `
  select p.id, p.code, p.name, c.id as client_id, c.slug as client_slug, c.name as client_name,
         p.status, p.phase, p.health, p.progress_pct, p.task_count, p.open_task_count,
         p.blocked_task_count, p.start_date, p.target_date, p.repo_url, p.plan_path, p.updated_at,
         p.objective_internal, p.objective_client, p.health_reason, p.require_evidence,
         p.client_can_confirm_receipt, p.owner_profile_id,
         (select pr.full_name from ${S}.profiles pr where pr.id = p.owner_profile_id) as owner_name,
         p.pm_agent_id,
         (select ag.name from ${S}.agents ag where ag.id = p.pm_agent_id) as pm_agent_name
    from ${S}.projects p
    join ${S}.clients c on c.id = p.client_id`;

type ProjectRow = {
  id: string;
  code: string;
  name: string;
  client_id: string;
  client_slug: string;
  client_name: string;
  status: ProjectSummary["status"];
  phase: ProjectSummary["phase"];
  health: ProjectSummary["health"];
  progress_pct: number;
  task_count: number;
  open_task_count: number;
  blocked_task_count: number;
  start_date: string | null;
  target_date: string | null;
  repo_url: string | null;
  plan_path: string | null;
  updated_at: Date | string;
  objective_internal: string | null;
  objective_client: string | null;
  health_reason: Record<string, unknown>;
  require_evidence: boolean;
  client_can_confirm_receipt: boolean;
  owner_profile_id: string | null;
  owner_name: string | null;
  pm_agent_id: string | null;
  pm_agent_name: string | null;
};

function toSummary(r: ProjectRow): ProjectSummary {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    client: { id: r.client_id, slug: r.client_slug, name: r.client_name },
    status: r.status,
    phase: r.phase,
    health: r.health,
    progress_pct: r.progress_pct,
    task_count: r.task_count,
    open_task_count: r.open_task_count,
    blocked_task_count: r.blocked_task_count,
    start_date: r.start_date,
    target_date: r.target_date,
    repo_url: r.repo_url,
    plan_path: r.plan_path,
    updated_at: iso(r.updated_at),
  };
}

export async function listProjects(
  t: TxCtx,
): Promise<{ items: ProjectSummary[] }> {
  authorize(t.actor, "project.read");
  const params: unknown[] = [];
  const rows = await many<ProjectRow>(
    t,
    `${PROJECT_SELECT}
      where p.archived_at is null and ${projectScopeSql(t.actor, "p.id", params)}
      order by p.code`,
    params,
  );
  return { items: rows.map(toSummary) };
}

async function projectRow(t: TxCtx, id: string): Promise<ProjectRow> {
  return (await maybeOne<ProjectRow>(t, `${PROJECT_SELECT} where p.id = $1`, [
    id,
  ]))!;
}

export async function getProject(
  t: TxCtx,
  code: string,
): Promise<ProjectDetail> {
  const ref = await resolveProject(t, code, "project.read");
  const r = await projectRow(t, ref.id);
  const departments = await many<{ slug: string; name: string }>(
    t,
    `select d.slug, d.name from ${S}.project_departments pd
       join ${S}.departments d on d.id = pd.department_id
      where pd.project_id = $1 order by d.sort_order`,
    [ref.id],
  );
  const milestones = await milestonesOfProject(t, ref.id);
  return {
    ...toSummary(r),
    objective_internal: r.objective_internal,
    objective_client: r.objective_client,
    health_reason: r.health_reason ?? {},
    require_evidence: r.require_evidence,
    client_can_confirm_receipt: r.client_can_confirm_receipt,
    owner: r.owner_profile_id
      ? actorRef("user", r.owner_profile_id, r.owner_name)
      : null,
    pm_agent: r.pm_agent_id
      ? actorRef("agent", r.pm_agent_id, r.pm_agent_name)
      : null,
    departments,
    next_milestones: milestones
      .filter((m) => m.status === "planned" || m.status === "in_progress")
      .slice(0, 3),
  };
}

type TaskSummaryRow = {
  code: string;
  project_code: string;
  title: string;
  status_name: string;
  status_category: TaskSummary["status_category"];
  priority: TaskSummary["priority"];
  assignee_type: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  due_date: string | null;
  blocked_reason: string | null;
  blocked_on_type: string | null;
  blocked_on_id: string | null;
  blocked_on_name: string | null;
  parent_code: string | null;
  workstream_id: string | null;
};

export const TASK_SUMMARY_SELECT = `
  select t.code, p.code as project_code, t.title, s.name as status_name, t.status_category,
         t.priority, t.assignee_type, t.assignee_id,
         ${ACTOR_NAME_SQL("t.assignee_type", "t.assignee_id")} as assignee_name,
         t.due_date, t.blocked_reason, t.blocked_on_type, t.blocked_on_id,
         ${ACTOR_NAME_SQL("t.blocked_on_type", "t.blocked_on_id")} as blocked_on_name,
         par.code as parent_code, t.workstream_id
    from ${S}.tasks t
    join ${S}.projects p on p.id = t.project_id
    join ${S}.task_statuses s on s.id = t.status_id
    left join ${S}.tasks par on par.id = t.parent_task_id`;

export function toTaskSummary(r: TaskSummaryRow): TaskSummary {
  return {
    code: r.code,
    project_code: r.project_code,
    title: r.title,
    status_name: r.status_name,
    status_category: r.status_category,
    priority: r.priority,
    assignee: actorRef(r.assignee_type, r.assignee_id, r.assignee_name),
    due_date: r.due_date,
    blocked_reason: r.blocked_reason,
    blocked_on: actorRef(r.blocked_on_type, r.blocked_on_id, r.blocked_on_name),
    parent_code: r.parent_code,
  };
}

/** Árvore do plano. `action` permite ler o plano para exportar (sync.plan). */
export async function getPlan(
  t: TxCtx,
  code: string,
  action: Action = "project.read",
): Promise<PlanDto> {
  const ref = await resolveProject(t, code, action);
  const project = toSummary(await projectRow(t, ref.id));
  const milestones = await milestonesOfProject(t, ref.id);
  const workstreams = await workstreamsOfProject(t, ref.id);
  const taskRows = await many<TaskSummaryRow>(
    t,
    `${TASK_SUMMARY_SELECT}
      where t.project_id = $1 and t.archived_at is null
      order by t.sort_key, t.created_at, t.id`,
    [ref.id],
  );

  // Subtarefas penduradas na tarefa-pai; tarefas agrupadas por frente.
  const subtasks = new Map<string, TaskSummary[]>();
  for (const row of taskRows) {
    if (row.parent_code) {
      const list = subtasks.get(row.parent_code) ?? [];
      list.push(toTaskSummary(row));
      subtasks.set(row.parent_code, list);
    }
  }
  const byWorkstream = new Map<string | null, PlanDto["unplanned"]["tasks"]>();
  for (const row of taskRows) {
    if (row.parent_code) continue;
    const key = row.workstream_id;
    const list = byWorkstream.get(key) ?? [];
    list.push({
      ...toTaskSummary(row),
      subtasks: subtasks.get(row.code) ?? [],
    });
    byWorkstream.set(key, list);
  }
  const planWorkstream = (w: (typeof workstreams)[number]) => ({
    ...w,
    tasks: byWorkstream.get(w.id) ?? [],
  });

  // Frente ligada a marco arquivado aparece em "sem marco", para não sumir do plano.
  const listed = new Set(milestones.map((m) => m.id));
  return {
    project,
    milestones: milestones.map((m) => ({
      ...m,
      workstreams: workstreams
        .filter((w) => w.milestone?.id === m.id)
        .map(planWorkstream),
    })),
    unplanned: {
      workstreams: workstreams
        .filter((w) => !w.milestone || !listed.has(w.milestone.id))
        .map(planWorkstream),
      tasks: byWorkstream.get(null) ?? [],
    },
  };
}

/**
 * Projeção do plano no formato `plan.md` (PRD §5.5). É a exportação simples do M1;
 * a sincronização nos dois sentidos, que preserva o resto do arquivo, chega no M4.
 */
/** Texto de uma linha só: quebras e espaços repetidos viram um espaço (defesa em camadas). */
export function oneLine(text: string): string {
  return text.replace(/[\s\u0000-\u001F\u007F-\u009F]+/g, " ").trim();
}

export function renderPlanMarkdown(plan: PlanDto): string {
  const lines: string[] = [`# PLAN.md — ${oneLine(plan.project.name)}`, ""];
  const box = (category: string) => (category === "done" ? "[x]" : "[ ]");
  const taskLines = (tasks: PlanDto["unplanned"]["tasks"]) => {
    for (const task of tasks) {
      lines.push(
        `- ${box(task.status_category)} ${oneLine(task.title)} (${task.code})`,
      );
      for (const sub of task.subtasks) {
        lines.push(
          `  - ${box(sub.status_category)} ${oneLine(sub.title)} (${sub.code})`,
        );
      }
    }
  };
  for (const m of plan.milestones) {
    lines.push(`## ${m.code} — ${oneLine(m.title)}`, "");
    for (const w of m.workstreams) {
      lines.push(`### ${oneLine(w.title)}`);
      taskLines(w.tasks);
      lines.push("");
    }
    if (m.gate_required) {
      lines.push(`### 🔒 GATE ${m.code} (aprovação do Fábio)`);
      const accepted = m.status === "accepted";
      if (m.acceptance_criteria.length === 0) {
        lines.push(`- ${accepted ? "[x]" : "[ ]"} Aceite do marco ${m.code}`);
      }
      for (const c of m.acceptance_criteria) {
        lines.push(
          `- ${accepted || c.done ? "[x]" : "[ ]"} ${oneLine(c.text)}`,
        );
      }
      lines.push("");
    }
  }
  if (
    plan.unplanned.workstreams.length > 0 ||
    plan.unplanned.tasks.length > 0
  ) {
    lines.push("## Sem marco", "");
    for (const w of plan.unplanned.workstreams) {
      lines.push(`### ${oneLine(w.title)}`);
      taskLines(w.tasks);
      lines.push("");
    }
    if (plan.unplanned.tasks.length > 0) {
      lines.push("### Tarefas sem frente");
      taskLines(plan.unplanned.tasks);
      lines.push("");
    }
  }
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

export async function getProjectHealth(
  t: TxCtx,
  code: string,
  now = new Date(),
): Promise<HealthDto> {
  const ref = await resolveProject(t, code, "project.read");
  const inputs = await maybeOne<{
    open_task_count: number;
    blocked_task_count: number;
    late_milestones: number;
    next_due_date: string | null;
    oldest_pending_approval_at: Date | string | null;
    stored: HealthDto["stored_health"];
  }>(
    t,
    `select v.open_task_count, v.blocked_task_count, v.late_milestones, v.next_due_date,
            v.oldest_pending_approval_at, p.health as stored
       from ${S}.v_project_health_inputs v
       join ${S}.projects p on p.id = v.project_id
      where v.project_id = $1`,
    [ref.id],
  );
  const base = inputs ?? {
    open_task_count: 0,
    blocked_task_count: 0,
    late_milestones: 0,
    next_due_date: null,
    oldest_pending_approval_at: null,
    stored: "healthy" as const,
  };
  const broken = (await dependencyAlertsOf(t, ref.id)).length;
  const forecast = await forecastInputsOf(t, ref.id);
  const result = computeHealth(
    { ...base, broken_dependencies: broken, forecast },
    now,
  );
  return {
    project_code: ref.code,
    health: result.health,
    reasons: result.reasons,
    inputs: {
      open_task_count: base.open_task_count,
      blocked_task_count: base.blocked_task_count,
      late_milestones: base.late_milestones,
      broken_dependencies: broken,
      tasks_done_last_14_days: forecast.done_recent,
      drifting_milestones: driftForecast(forecast),
      next_due_date: base.next_due_date,
      oldest_pending_approval_at: isoOrNull(base.oldest_pending_approval_at),
    },
    stored_health: base.stored,
  };
}
