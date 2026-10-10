import { formatDate } from "@/lib/format";
import { PRIORITY } from "@/lib/labels";
import { listComments, type CommentDto } from "@/modules/comments/service";
import {
  ACTOR_NAME_SQL,
  actorRef,
  authorizeProjectId,
  iso,
  type ActorRef,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import type { ProjectDetail } from "@/modules/projects/schemas";
import { getProject } from "@/modules/projects/service";
import type { TaskDto } from "./schemas";
import { getTask, TASK_SELECT, toTaskDto, type TaskRow } from "./service";

/**
 * Dados das telas de tarefas (lista, painel da tarefa e, depois, o quadro). Só leitura:
 * as mudanças passam pelos casos de uso de service.ts, com permissão e registro.
 */

/** Status do projeto, na ordem configurada (A fazer, Em andamento...). */
export type StatusOption = {
  id: string;
  name: string;
  category: TaskDto["status"]["category"];
  color: string;
};

export type WorkstreamOption = { id: string; title: string };

/** Quem pode ser responsável: pessoas ativas do workspace e agentes não revogados. */
export type AssigneeOption = {
  type: "user" | "agent";
  id: string;
  name: string;
  paused: boolean;
};

export type TaskFormOptions = {
  statuses: StatusOption[];
  workstreams: WorkstreamOption[];
  assignees: AssigneeOption[];
};

export async function taskFormOptions(
  t: TxCtx,
  projectId: string,
): Promise<TaskFormOptions> {
  const statuses = await many<StatusOption>(
    t,
    `select id, name, category::text as category, color
       from ${S}.task_statuses where project_id = $1
      order by sort_order, name`,
    [projectId],
  );
  const workstreams = await many<WorkstreamOption>(
    t,
    `select id, title from ${S}.workstreams
      where project_id = $1 and archived_at is null
      order by sort_order, title`,
    [projectId],
  );
  const people = await many<{ id: string; name: string }>(
    t,
    `select pr.id, pr.full_name as name
       from ${S}.memberships m
       join ${S}.profiles pr on pr.id = m.profile_id
      where m.workspace_id = $1 and m.status = 'active' and pr.deactivated_at is null
      order by pr.full_name`,
    [t.actor.workspaceId],
  );
  const agents = await many<{ id: string; name: string; status: string }>(
    t,
    `select id, name, status::text as status from ${S}.agents
      where workspace_id = $1 and status <> 'revoked'
      order by name`,
    [t.actor.workspaceId],
  );
  return {
    statuses,
    workstreams,
    assignees: [
      ...people.map((p) => ({
        type: "user" as const,
        id: p.id,
        name: p.name,
        paused: false,
      })),
      ...agents.map((a) => ({
        type: "agent" as const,
        id: a.id,
        name: a.name,
        paused: a.status === "paused",
      })),
    ],
  };
}

/** Hoje no fuso do workspace (AAAA-MM-DD): withActor ajusta o fuso da transação. */
async function today(t: TxCtx): Promise<string> {
  return (await maybeOne<{ today: string }>(
    t,
    "select current_date::text as today",
  ))!.today;
}

// Lista do projeto -------------------------------------------------------------------

/** Concluídas aparecem só as mais recentes; as abertas aparecem todas. */
export const DONE_LIMIT = 50;
const OPEN_LIMIT = 500;

/** "none" mostra as tarefas sem frente; um id, as daquela frente. */
export type TaskListFilter = { workstream?: string };

export type ProjectTaskList = TaskFormOptions & {
  project: ProjectDetail;
  today: string;
  /** Frente filtrada, já conferida: "none", o id de uma frente do projeto ou null. */
  workstream: string | null;
  tasks: TaskDto[];
  doneTotal: number;
};

const LIST_ORDER = `
  case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
  t.due_date nulls last, t.sort_key, t.created_at, t.id`;

export async function projectTaskList(
  t: TxCtx,
  code: string,
  filter: TaskListFilter = {},
): Promise<ProjectTaskList> {
  // getProject confere a leitura do projeto; a lista exige também a leitura de tarefas.
  const project = await getProject(t, code);
  await authorizeProjectId(t, project.id, "task.read");
  const options = await taskFormOptions(t, project.id);

  const workstream =
    filter.workstream === "none"
      ? "none"
      : options.workstreams.some((w) => w.id === filter.workstream)
        ? filter.workstream!
        : null;
  const params: unknown[] = [project.id];
  let where = "t.project_id = $1 and t.archived_at is null";
  if (workstream === "none") {
    where += " and t.workstream_id is null";
  } else if (workstream) {
    params.push(workstream);
    where += " and t.workstream_id = $2";
  }

  const open = await many<TaskRow>(
    t,
    `${TASK_SELECT} where ${where} and t.status_category <> 'done'
      order by ${LIST_ORDER} limit ${OPEN_LIMIT}`,
    params,
  );
  const done = await many<TaskRow>(
    t,
    `${TASK_SELECT} where ${where} and t.status_category = 'done'
      order by t.completed_at desc, t.id limit ${DONE_LIMIT}`,
    params,
  );
  const doneTotal = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.tasks t
      where ${where} and t.status_category = 'done'`,
    params,
  );
  return {
    ...options,
    project,
    today: await today(t),
    workstream,
    tasks: [...open, ...done].map(toTaskDto),
    doneTotal: doneTotal?.n ?? 0,
  };
}

// Painel da tarefa -------------------------------------------------------------------

/** Uma linha do histórico da tarefa, com o verbo em PT-BR e o detalhe que importa. */
export type TaskEvent = {
  at: string;
  actor: ActorRef | null;
  text: string;
  detail: string | null;
};

export type TaskDetail = TaskFormOptions & {
  task: TaskDto;
  today: string;
  subtasks: TaskDto[];
  comments: CommentDto[];
  history: TaskEvent[];
};

type HistoryRow = {
  created_at: Date | string;
  action: string;
  actor_type: string | null;
  actor_id: string | null;
  actor_name: string | null;
  after: unknown;
};

export async function taskDetail(t: TxCtx, code: string): Promise<TaskDetail> {
  // getTask confere a leitura de tarefas no projeto da tarefa.
  const task = await getTask(t, code);
  const projectId = (await maybeOne<{ project_id: string }>(
    t,
    `select project_id from ${S}.tasks where id = $1`,
    [task.id],
  ))!.project_id;
  const options = await taskFormOptions(t, projectId);
  const subtasks = await many<TaskRow>(
    t,
    `${TASK_SELECT} where t.parent_task_id = $1 and t.archived_at is null
      order by t.created_at, t.id limit 100`,
    [task.id],
  );
  const { items: comments } = await listComments(t, { task: task.code });
  const history = await many<HistoryRow>(
    t,
    `select a.created_at, a.action, a.actor_type::text as actor_type, a.actor_id,
            ${ACTOR_NAME_SQL("a.actor_type::text", "a.actor_id")} as actor_name, a.after
       from ${S}.activity_log a
      where (a.entity_type = 'task' and a.entity_id = $1)
         or (a.entity_type = 'comment' and a.entity_id in (
               select c.id from ${S}.comments c
                where c.entity_type = 'task' and c.entity_id = $1))
      order by a.id desc limit 40`,
    [task.id],
  );
  return {
    ...options,
    task,
    today: await today(t),
    subtasks: subtasks.map(toTaskDto),
    comments,
    history: history.map((h) => ({
      at: iso(h.created_at),
      actor: actorRef(h.actor_type, h.actor_id, h.actor_name),
      ...describeTaskEvent(h.action, h.after),
    })),
  };
}

// Histórico em PT-BR -----------------------------------------------------------------

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** O que mudou em cada campo, com o valor novo quando ele cabe numa frase. */
function fieldChange(key: string, value: unknown): string | null {
  switch (key) {
    case "status":
      return text(value) ? `mudou o status para ${text(value)}` : null;
    case "priority": {
      const label = PRIORITY[value as keyof typeof PRIORITY]?.label;
      return label ? `mudou a prioridade para ${label}` : "mudou a prioridade";
    }
    case "due_date":
      return value
        ? `mudou o prazo para ${formatDate(String(value))}`
        : "tirou o prazo";
    case "start_date":
      return value
        ? `mudou o início para ${formatDate(String(value))}`
        : "tirou o início";
    case "assignee":
      return value ? "trocou o responsável" : "tirou o responsável";
    case "workstream":
      return value ? "mudou a frente" : "tirou a frente";
    case "title":
      return "mudou o título";
    case "description_md":
      return "editou a descrição";
    case "estimate_minutes":
      return "mudou a estimativa";
    case "sort_key":
      return "mudou a ordem";
    case "external_ref":
      return "mudou a referência externa";
    default:
      return null;
  }
}

const FIELD_ORDER = [
  "status",
  "title",
  "assignee",
  "priority",
  "due_date",
  "start_date",
  "workstream",
  "description_md",
  "estimate_minutes",
  "external_ref",
  "sort_key",
] as const;

/** "a", "a e b", "a, b e c". */
function joinPt(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

export function describeTaskEvent(
  action: string,
  after: unknown,
): { text: string; detail: string | null } {
  const a =
    after && typeof after === "object"
      ? (after as Record<string, unknown>)
      : {};
  switch (action) {
    case "task.created":
      return { text: "criou a tarefa", detail: null };
    case "task.started":
      return { text: "começou a tarefa", detail: null };
    case "task.completed":
      return { text: "concluiu a tarefa", detail: text(a.done_evidence) };
    case "task.blocked":
      return { text: "bloqueou a tarefa", detail: text(a.blocked_reason) };
    case "task.reopened":
      return { text: "reabriu a tarefa", detail: text(a.reason) };
    case "comment.created":
      return { text: "comentou", detail: null };
    case "task.updated": {
      // Ordem fixa: o banco (jsonb) não guarda a ordem em que os campos mudaram. O motivo
      // do bloqueio, apagado ao sair do bloqueio, já está dito na mudança de status.
      const parts = FIELD_ORDER.filter((k) => k in a)
        .map((k) => fieldChange(k, a[k]))
        .filter((p): p is string => p !== null);
      return { text: joinPt(parts) || "atualizou a tarefa", detail: null };
    }
    default:
      return { text: action, detail: null };
  }
}
