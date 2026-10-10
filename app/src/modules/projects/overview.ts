import { ACTOR_NAME_SQL, actorRef, iso, type ActorRef } from "@/modules/common";
import { many, S, type TxCtx } from "@/modules/context";
import { milestonesOfProject } from "@/modules/milestones/service";
import { workstreamsOfProject } from "@/modules/workstreams/service";
import type {
  MilestoneDto,
  ProjectDetail,
  ProjectSummary,
  TaskSummary,
  WorkstreamDto,
} from "./schemas";
import {
  getProject,
  listProjects,
  TASK_SUMMARY_SELECT,
  toTaskSummary,
} from "./service";

/** Uma linha da atividade recente do projeto, já com o verbo em PT-BR. */
export type ActivityItem = {
  at: string;
  actor: ActorRef | null;
  action: string;
  /** Verbo e objeto, sem o nome de quem fez: "concluiu HUB-12". */
  text: string;
};

/** Visão geral do projeto nas três camadas (estratégica, tática e operacional). */
export type ProjectOverview = {
  project: ProjectDetail;
  milestones: MilestoneDto[];
  workstreams: WorkstreamDto[];
  /** Abertas e fora de bloqueio, na ordem de trabalho. */
  queue: TaskSummary[];
  blocked: TaskSummary[];
  activity: ActivityItem[];
};

const VERBS: Record<string, string> = {
  "task.created": "criou",
  "task.started": "começou",
  "task.completed": "concluiu",
  "task.blocked": "bloqueou",
  "task.reopened": "reabriu",
  "task.updated": "atualizou",
  "comment.created": "comentou em",
  "time.logged": "lançou tempo em",
  "workstream.created": "criou uma frente",
  "workstream.updated": "atualizou uma frente",
  "project.health_changed": "mudou a saúde do projeto",
  "approval.requested": "pediu uma aprovação",
  "approval.decided": "decidiu uma aprovação",
  "report.drafted": "rascunhou um relatório",
};

export function describeActivity(action: string, taskCode: string | null) {
  const verb = VERBS[action] ?? action;
  return taskCode && action.startsWith("task.") ? `${verb} ${taskCode}` : verb;
}

const QUEUE_ORDER = `
  order by case t.status_category when 'in_progress' then 0 when 'review' then 1
                                  when 'todo' then 2 else 3 end,
           case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
           t.due_date nulls last, t.created_at`;

type SummaryRow = Parameters<typeof toTaskSummary>[0];

type ActivityRow = {
  created_at: Date | string;
  action: string;
  actor_type: string | null;
  actor_id: string | null;
  actor_name: string | null;
  task_code: string | null;
};

/** Linha da tela Projetos: o resumo, o próximo marco e o motivo da saúde. */
export type ProjectBoardRow = ProjectSummary & {
  next_milestone: {
    code: string;
    title: string;
    due_date: string | null;
    late: boolean;
  } | null;
  health_reasons: string[];
};

export async function listProjectsBoard(t: TxCtx): Promise<ProjectBoardRow[]> {
  // listProjects confere o acesso e aplica o escopo de quem está vendo.
  const { items } = await listProjects(t);
  if (items.length === 0) return [];
  const extras = await many<{
    id: string;
    health_reason: { reasons?: unknown } | null;
    m_code: string | null;
    m_title: string | null;
    m_due: string | null;
    m_late: boolean | null;
  }>(
    t,
    `select p.id, p.health_reason, nm.code as m_code, nm.title as m_title, nm.due_date as m_due,
            nm.due_date < current_date as m_late
       from ${S}.projects p
       left join lateral (
         select m.code, m.title, m.due_date
           from ${S}.milestones m
          where m.project_id = p.id and m.archived_at is null
            and m.status in ('planned', 'in_progress')
          order by m.sort_order, m.code
          limit 1
       ) nm on true
      where p.id = any($1::uuid[])`,
    [items.map((p) => p.id)],
  );
  // current_date segue o fuso do workspace, ajustado em cada transação (withActor).
  const byId = new Map(extras.map((e) => [e.id, e]));
  return items.map((p) => {
    const e = byId.get(p.id);
    const reasons = Array.isArray(e?.health_reason?.reasons)
      ? (e.health_reason.reasons as unknown[]).filter(
          (r): r is string => typeof r === "string",
        )
      : [];
    return {
      ...p,
      next_milestone:
        e?.m_code && e.m_title
          ? {
              code: e.m_code,
              title: e.m_title,
              due_date: e.m_due,
              late: e.m_late === true,
            }
          : null,
      health_reasons: reasons,
    };
  });
}

export async function projectOverview(
  t: TxCtx,
  code: string,
): Promise<ProjectOverview> {
  // getProject confere o acesso ao projeto (project.read) antes de qualquer leitura.
  const project = await getProject(t, code);
  const milestones = await milestonesOfProject(t, project.id);
  const workstreams = await workstreamsOfProject(t, project.id);

  const queue = await many<SummaryRow>(
    t,
    `${TASK_SUMMARY_SELECT}
      where t.project_id = $1 and t.archived_at is null
        and t.status_category not in ('done', 'blocked')
      ${QUEUE_ORDER} limit 12`,
    [project.id],
  );
  const blocked = await many<SummaryRow>(
    t,
    `${TASK_SUMMARY_SELECT}
      where t.project_id = $1 and t.archived_at is null
        and t.status_category = 'blocked'
      order by t.updated_at, t.created_at limit 10`,
    [project.id],
  );
  const activity = await many<ActivityRow>(
    t,
    `select a.created_at, a.action, a.actor_type::text as actor_type, a.actor_id,
            ${ACTOR_NAME_SQL("a.actor_type::text", "a.actor_id")} as actor_name,
            tk.code as task_code
       from ${S}.activity_log a
       left join ${S}.tasks tk on a.entity_type = 'task' and tk.id = a.entity_id
      where a.project_id = $1
      order by a.id desc limit 12`,
    [project.id],
  );

  return {
    project,
    milestones,
    workstreams,
    queue: queue.map(toTaskSummary),
    blocked: blocked.map(toTaskSummary),
    activity: activity.map((a) => ({
      at: iso(a.created_at),
      actor: actorRef(a.actor_type, a.actor_id, a.actor_name),
      action: a.action,
      text: describeActivity(a.action, a.task_code),
    })),
  };
}
