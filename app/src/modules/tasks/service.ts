import { authorize, type Action } from "@/lib/authorize";
import { audit, changedFields } from "@/lib/audit";
import {
  badRequest,
  conflict,
  notFound,
  preconditionFailed,
  unprocessable,
} from "@/lib/errors";
import {
  CURSOR_AT_SQL,
  decodeCursor,
  parseLimit,
  toPage,
  type Page,
} from "@/lib/pagination";
import { assertNoSecrets } from "@/lib/text-guards";
import {
  ACTOR_NAME_SQL,
  actorRef,
  authorizeProjectId,
  type AssigneeRef,
  iso,
  isoOrNull,
  projectScopeSql,
  resolveAssignee,
  resolveProject,
  TaskCode,
  Uuid,
} from "@/modules/common";
import { many, maybeOne, S, type Source, type TxCtx } from "@/modules/context";
import { emitEvent, recomputeRollup } from "@/modules/events";
import { notifyProfile } from "@/modules/notifications";
import type {
  CreateTaskInput,
  TaskDto,
  TaskFilter,
  UpdateTaskInput,
} from "@/modules/tasks/schemas";

/** Leitura completa da tarefa (TaskDto), compartilhada com as telas (board.ts). */
export const TASK_SELECT = `
  select t.id, t.code, p.code as project_code, t.project_id, t.title, t.description_md,
         t.status_id, s.name as status_name, t.status_category, s.color as status_color,
         t.priority, t.assignee_type, t.assignee_id,
         ${ACTOR_NAME_SQL("t.assignee_type", "t.assignee_id")} as assignee_name,
         t.workstream_id, w.title as workstream_title, par.code as parent_code,
         t.start_date, t.due_date, t.estimate_minutes, t.sort_key, t.source, t.external_ref,
         t.done_evidence, t.blocked_reason, t.blocked_on_type, t.blocked_on_id,
         ${ACTOR_NAME_SQL("t.blocked_on_type", "t.blocked_on_id")} as blocked_on_name,
         t.completed_at, t.completed_by_type, t.completed_by_id,
         ${ACTOR_NAME_SQL("t.completed_by_type", "t.completed_by_id")} as completed_by_name,
         t.created_by_type, t.created_by_id,
         ${ACTOR_NAME_SQL("t.created_by_type", "t.created_by_id")} as created_by_name,
         t.version, t.created_at, t.updated_at, t.archived_at,
         ${CURSOR_AT_SQL("t")} as cursor_at
    from ${S}.tasks t
    join ${S}.projects p on p.id = t.project_id
    join ${S}.task_statuses s on s.id = t.status_id
    left join ${S}.workstreams w on w.id = t.workstream_id
    left join ${S}.tasks par on par.id = t.parent_task_id`;

export type TaskRow = {
  id: string;
  code: string;
  project_code: string;
  project_id: string;
  title: string;
  description_md: string | null;
  status_id: string;
  status_name: string;
  status_category: TaskDto["status"]["category"];
  status_color: string;
  priority: TaskDto["priority"];
  assignee_type: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  workstream_id: string | null;
  workstream_title: string | null;
  parent_code: string | null;
  start_date: string | null;
  due_date: string | null;
  estimate_minutes: number | null;
  sort_key: number;
  source: string;
  external_ref: string | null;
  done_evidence: string | null;
  blocked_reason: string | null;
  blocked_on_type: string | null;
  blocked_on_id: string | null;
  blocked_on_name: string | null;
  completed_at: Date | string | null;
  completed_by_type: string | null;
  completed_by_id: string | null;
  completed_by_name: string | null;
  created_by_type: string;
  created_by_id: string | null;
  created_by_name: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
  cursor_at: string;
};

export function toTaskDto(r: TaskRow): TaskDto {
  return {
    id: r.id,
    code: r.code,
    project_code: r.project_code,
    title: r.title,
    description_md: r.description_md,
    status: {
      id: r.status_id,
      name: r.status_name,
      category: r.status_category,
      color: r.status_color,
    },
    priority: r.priority,
    assignee: actorRef(r.assignee_type, r.assignee_id, r.assignee_name),
    workstream:
      r.workstream_id && r.workstream_title
        ? { id: r.workstream_id, title: r.workstream_title }
        : null,
    parent_code: r.parent_code,
    start_date: r.start_date,
    due_date: r.due_date,
    estimate_minutes: r.estimate_minutes,
    sort_key: r.sort_key,
    source: r.source,
    external_ref: r.external_ref,
    done_evidence: r.done_evidence,
    blocked_reason: r.blocked_reason,
    blocked_on: actorRef(r.blocked_on_type, r.blocked_on_id, r.blocked_on_name),
    completed_at: isoOrNull(r.completed_at),
    completed_by: actorRef(
      r.completed_by_type,
      r.completed_by_id,
      r.completed_by_name,
    ),
    created_by: actorRef(
      r.created_by_type,
      r.created_by_id,
      r.created_by_name,
    )!,
    version: r.version,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    archived_at: isoOrNull(r.archived_at),
  };
}

async function taskById(t: TxCtx, id: string): Promise<TaskDto> {
  const row = await maybeOne<TaskRow>(t, `${TASK_SELECT} where t.id = $1`, [
    id,
  ]);
  if (!row) throw notFound("Tarefa não encontrada.");
  return toTaskDto(row);
}

function parseTaskCode(code: string): string {
  const parsed = TaskCode.safeParse(code);
  if (!parsed.success) {
    throw badRequest("Código de tarefa inválido: use o formato HUB-123.");
  }
  return parsed.data;
}

type LockedTask = {
  id: string;
  code: string;
  project_id: string;
  workstream_id: string | null;
  version: number;
  status_category: TaskDto["status"]["category"];
  assignee_type: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
};

/** Trava a tarefa para alteração e confere a permissão do ator no projeto dela. */
export async function lockTask(
  t: TxCtx,
  code: string,
  action: Action,
): Promise<LockedTask> {
  const taskCode = parseTaskCode(code);
  const row = await maybeOne<LockedTask>(
    t,
    `select t.id, t.code, t.project_id, t.workstream_id, t.version, t.status_category,
            t.assignee_type, t.assignee_id,
            ${ACTOR_NAME_SQL("t.assignee_type", "t.assignee_id")} as assignee_name
       from ${S}.tasks t
      where t.code = $1 and t.archived_at is null
      for update of t`,
    [taskCode],
  );
  if (!row)
    throw notFound(`Tarefa ${taskCode} não encontrada neste workspace.`);
  await authorizeProjectId(t, row.project_id, action);
  return row;
}

export async function getTask(t: TxCtx, code: string): Promise<TaskDto> {
  const taskCode = parseTaskCode(code);
  const row = await maybeOne<TaskRow>(t, `${TASK_SELECT} where t.code = $1`, [
    taskCode,
  ]);
  if (!row)
    throw notFound(`Tarefa ${taskCode} não encontrada neste workspace.`);
  await authorizeProjectId(t, row.project_id, "task.read");
  return toTaskDto(row);
}

export async function listTasks(
  t: TxCtx,
  filter: TaskFilter,
): Promise<Page<TaskDto>> {
  const params: unknown[] = [];
  const where = [
    "t.archived_at is null",
    projectScopeSql(t.actor, "t.project_id", params),
  ];

  if (filter.project) {
    const project = await resolveProject(t, filter.project, "task.read");
    params.push(project.id);
    where.push(`t.project_id = $${params.length}`);
  } else {
    authorize(t.actor, "task.read");
  }

  if (filter.assignee === "me") {
    if (!t.actor.id)
      throw badRequest('assignee "me" exige um ator identificado.');
    params.push(t.actor.type, t.actor.id);
    where.push(
      `t.assignee_type::text = $${params.length - 1} and t.assignee_id = $${params.length}`,
    );
  } else if (filter.assignee === "none") {
    where.push("t.assignee_type is null");
  } else if (filter.assignee) {
    const [type, id] = filter.assignee.split(":");
    params.push(type, id);
    where.push(
      `t.assignee_type::text = $${params.length - 1} and t.assignee_id = $${params.length}::uuid`,
    );
  }
  if (filter.status_category?.length) {
    params.push(filter.status_category);
    where.push(`t.status_category::text = any($${params.length}::text[])`);
  }
  if (filter.due_before) {
    params.push(filter.due_before);
    where.push(`t.due_date <= $${params.length}::date`);
  }
  if (filter.blocked !== undefined) {
    where.push(
      filter.blocked
        ? "t.status_category = 'blocked'"
        : "t.status_category <> 'blocked'",
    );
  }
  if (filter.workstream_id) {
    params.push(filter.workstream_id);
    where.push(`t.workstream_id = $${params.length}`);
  }
  if (filter.parent) {
    params.push(filter.parent);
    where.push(`par.code = $${params.length}`);
  }
  const cursor = decodeCursor(filter.cursor);
  if (cursor) {
    params.push(cursor.at, cursor.id);
    where.push(
      `(t.created_at, t.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }
  const limit = parseLimit(filter.limit);
  params.push(limit + 1);
  const rows = await many<TaskRow>(
    t,
    `${TASK_SELECT} where ${where.join(" and ")}
     order by t.created_at, t.id
     limit $${params.length}`,
    params,
  );
  return toPage(rows, limit, toTaskDto);
}

// Apoio ------------------------------------------------------------------------------

const SOURCE_BY_CHANNEL: Record<Source, string> = {
  api: "api",
  mcp: "mcp",
  ui: "hub",
  sync: "plan_md",
  webhook: "github",
  cron: "hub",
  system: "hub",
};

async function statusByCategory(
  t: TxCtx,
  projectId: string,
  category: TaskDto["status"]["category"],
  label: string,
): Promise<string> {
  const row = await maybeOne<{ id: string }>(
    t,
    `select id from ${S}.task_statuses
      where project_id = $1 and category = $2
      order by is_default desc, sort_order, name limit 1`,
    [projectId, category],
  );
  if (!row) {
    throw unprocessable(
      `O projeto não tem um status na categoria ${label}. Peça ao Fábio para criar.`,
    );
  }
  return row.id;
}

const defaultStatus = (t: TxCtx, projectId: string) =>
  statusByCategory(t, projectId, "todo", "A fazer");

async function assertWorkstreamInProject(
  t: TxCtx,
  workstreamId: string,
  projectId: string,
): Promise<void> {
  const ws = await maybeOne(
    t,
    `select 1 from ${S}.workstreams where id = $1 and project_id = $2 and archived_at is null`,
    [workstreamId, projectId],
  );
  if (!ws)
    throw unprocessable("A frente indicada não pertence a este projeto.");
}

function assertDates(start?: string | null, due?: string | null) {
  if (start && due && due < start) {
    throw badRequest("A data de entrega não pode ser anterior ao início.");
  }
}

// Avisos ---------------------------------------------------------------------------

/** A pessoa que passou a ser responsável recebe aviso (agentes leem a fila pelo MCP). */
async function notifyAssignee(t: TxCtx, task: TaskDto): Promise<void> {
  if (task.assignee?.type !== "user" || !task.assignee.id) return;
  await notifyProfile(
    t,
    task.assignee.id,
    "task.assigned",
    { type: "task", id: task.id },
    {
      by: t.actor.name,
      task_code: task.code,
      title: task.title,
      project_code: task.project_code,
    },
  );
}

// Casos de uso -----------------------------------------------------------------------

export async function createTask(
  t: TxCtx,
  input: CreateTaskInput,
): Promise<TaskDto> {
  const project = await resolveProject(t, input.project, "task.write");
  assertNoSecrets({
    title: input.title,
    description_md: input.description_md,
    external_ref: input.external_ref,
  });
  assertDates(input.start_date, input.due_date);

  let workstreamId = input.workstream_id ?? null;
  let parentId: string | null = null;
  if (input.parent) {
    const parent = await maybeOne<{
      id: string;
      parent_task_id: string | null;
      workstream_id: string | null;
    }>(
      t,
      `select id, parent_task_id, workstream_id from ${S}.tasks
        where code = $1 and project_id = $2 and archived_at is null`,
      [input.parent, project.id],
    );
    if (!parent) {
      throw unprocessable(
        `A tarefa-pai ${input.parent} não está no projeto ${project.code}.`,
      );
    }
    if (parent.parent_task_id) {
      throw unprocessable(
        "Subtarefa tem um nível só: escolha uma tarefa-pai de primeiro nível.",
      );
    }
    parentId = parent.id;
    workstreamId = workstreamId ?? parent.workstream_id;
  }
  if (workstreamId)
    await assertWorkstreamInProject(t, workstreamId, project.id);
  const assignee = input.assignee
    ? await resolveAssignee(t, input.assignee)
    : null;
  const statusId = await defaultStatus(t, project.id);

  const code = (
    await maybeOne<{ code: string }>(
      t,
      `select ${S}.next_task_code($1) as code`,
      [t.actor.workspaceId],
    )
  )?.code;
  if (!code) throw unprocessable("Não foi possível gerar o código da tarefa.");

  const inserted = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.tasks
       (workspace_id, project_id, workstream_id, parent_task_id, code, title, description_md,
        status_id, priority, assignee_type, assignee_id, start_date, due_date, estimate_minutes,
        external_ref, source, created_by_type, created_by_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     returning id`,
    [
      t.actor.workspaceId,
      project.id,
      workstreamId,
      parentId,
      code,
      input.title,
      input.description_md ?? null,
      statusId,
      input.priority ?? "normal",
      assignee?.type ?? null,
      assignee?.id ?? null,
      input.start_date ?? null,
      input.due_date ?? null,
      input.estimate_minutes ?? null,
      input.external_ref ?? null,
      SOURCE_BY_CHANNEL[t.source],
      t.actor.type,
      t.actor.id,
    ],
  );
  await recomputeRollup(t, project.id);
  const dto = await taskById(t, inserted!.id);
  await audit(t, {
    action: "task.created",
    entityType: "task",
    entityId: dto.id,
    projectId: project.id,
    after: {
      code: dto.code,
      title: dto.title,
      status: dto.status.name,
      priority: dto.priority,
      assignee: dto.assignee,
      workstream_id: workstreamId,
      parent_code: dto.parent_code,
    },
  });
  await emitEvent(t, "task.created", {
    code: dto.code,
    project_code: dto.project_code,
    title: dto.title,
  });
  await notifyAssignee(t, dto);
  return dto;
}

const UPDATE_AUDIT_KEYS = [
  "title",
  "description_md",
  "priority",
  "assignee",
  "start_date",
  "due_date",
  "estimate_minutes",
  "workstream",
  "status",
  "sort_key",
  "external_ref",
  "blocked_reason",
] as const;

export async function updateTask(
  t: TxCtx,
  code: string,
  input: UpdateTaskInput,
  expectedVersion?: number,
): Promise<TaskDto> {
  const row = await lockTask(t, code, "task.write");
  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    throw preconditionFailed(
      `A tarefa ${row.code} mudou desde a sua leitura (versão atual ${row.version}). Leia de novo e reaplique a mudança.`,
      { current_version: row.version },
    );
  }
  if (Object.keys(input).length === 0) {
    throw badRequest("Nada para atualizar: envie ao menos um campo.");
  }
  assertNoSecrets({
    title: input.title,
    description_md: input.description_md,
    external_ref: input.external_ref,
  });

  const before = await taskById(t, row.id);
  assertDates(
    input.start_date === undefined ? before.start_date : input.start_date,
    input.due_date === undefined ? before.due_date : input.due_date,
  );

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (input.title !== undefined) set("title", input.title);
  if (input.description_md !== undefined)
    set("description_md", input.description_md);
  if (input.priority !== undefined) set("priority", input.priority);
  if (input.start_date !== undefined) set("start_date", input.start_date);
  if (input.due_date !== undefined) set("due_date", input.due_date);
  if (input.estimate_minutes !== undefined)
    set("estimate_minutes", input.estimate_minutes);
  if (input.sort_key !== undefined) set("sort_key", input.sort_key);
  if (input.external_ref !== undefined) set("external_ref", input.external_ref);
  if (input.assignee !== undefined) {
    const assignee = input.assignee
      ? await resolveAssignee(t, input.assignee)
      : null;
    set("assignee_type", assignee?.type ?? null);
    set("assignee_id", assignee?.id ?? null);
  }
  if (input.workstream_id !== undefined) {
    if (input.workstream_id) {
      await assertWorkstreamInProject(t, input.workstream_id, row.project_id);
    }
    set("workstream_id", input.workstream_id);
  }
  if (input.status !== undefined) {
    if (row.status_category === "done") {
      throw conflict(
        `A tarefa ${row.code} está concluída. Reabra antes de mudar o status.`,
      );
    }
    const status = await maybeOne<{ id: string; category: string }>(
      t,
      `select id, category from ${S}.task_statuses
        where project_id = $1 and lower(name) = lower($2)`,
      [row.project_id, input.status],
    );
    if (!status) {
      const names = await many<{ name: string }>(
        t,
        `select name from ${S}.task_statuses where project_id = $1 order by sort_order`,
        [row.project_id],
      );
      throw unprocessable(
        `Status "${input.status}" não existe neste projeto. Opções: ${names.map((n) => n.name).join(", ")}.`,
      );
    }
    if (status.category === "done" || status.category === "blocked") {
      throw unprocessable(
        "Para concluir use a ação de concluir, com evidência; para bloquear, a ação de bloquear, com o motivo.",
      );
    }
    set("status_id", status.id);
    if (row.status_category === "blocked") {
      set("blocked_reason", null);
      set("blocked_on_type", null);
      set("blocked_on_id", null);
    }
  }

  params.push(row.id);
  await t.tx.query(
    `update ${S}.tasks set ${sets.join(", ")} where id = $${params.length}`,
    params,
  );
  await recomputeRollup(t, row.project_id);
  const after = await taskById(t, row.id);
  const flat = (d: TaskDto) => ({
    ...d,
    status: d.status.name,
    workstream: d.workstream?.id ?? null,
    assignee: d.assignee ? `${d.assignee.type}:${d.assignee.id}` : null,
  });
  await audit(t, {
    action: "task.updated",
    entityType: "task",
    entityId: row.id,
    projectId: row.project_id,
    ...changedFields(flat(before), flat(after), UPDATE_AUDIT_KEYS),
  });
  await emitEvent(t, "task.updated", {
    code: after.code,
    project_code: after.project_code,
    version: after.version,
  });
  if (flat(before).assignee !== flat(after).assignee) {
    await notifyAssignee(t, after);
  }
  return after;
}

async function maxInProgress(t: TxCtx, agentId: string): Promise<number> {
  const row = await maybeOne<{ max: number | null }>(
    t,
    `select (config ->> 'max_in_progress')::int as max from ${S}.agents where id = $1`,
    [agentId],
  );
  return row?.max && row.max > 0 ? row.max : 1;
}

export async function startTask(t: TxCtx, code: string): Promise<TaskDto> {
  const row = await lockTask(t, code, "task.transition");
  if (row.status_category === "done") {
    throw conflict(
      `A tarefa ${row.code} está concluída. Reabra antes de iniciar.`,
    );
  }
  if (t.actor.type === "system" || !t.actor.id) {
    throw badRequest("Iniciar uma tarefa exige uma pessoa ou um agente.");
  }
  const isMine =
    row.assignee_type === t.actor.type && row.assignee_id === t.actor.id;
  if (row.assignee_type && !isMine) {
    throw conflict(
      `A tarefa ${row.code} está com ${row.assignee_name ?? "outra pessoa"}. Peça a reatribuição ou escolha outra tarefa.`,
    );
  }
  if (row.status_category === "in_progress" && isMine) {
    return taskById(t, row.id);
  }
  if (t.actor.type === "agent") {
    // Uma trava por agente até o fim da transação: dois inícios ao mesmo tempo não
    // conseguem passar juntos pelo limite de tarefas em andamento.
    await t.tx.query(
      `select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hub:start:' || $1::text, 0))`,
      [t.actor.id],
    );
    const max = await maxInProgress(t, t.actor.id);
    const others = await many<{ code: string }>(
      t,
      `select code from ${S}.tasks
        where assignee_type = 'agent' and assignee_id = $1 and status_category = 'in_progress'
          and archived_at is null and id <> $2
        order by code`,
      [t.actor.id, row.id],
    );
    if (others.length >= max) {
      throw conflict(
        `Você já tem ${others.map((o) => o.code).join(", ")} em andamento. Conclua, bloqueie ou devolva antes de iniciar outra.`,
        { in_progress: others.map((o) => o.code) },
      );
    }
  }
  const statusId = await statusByCategory(
    t,
    row.project_id,
    "in_progress",
    "Em andamento",
  );
  await t.tx.query(
    `update ${S}.tasks
        set status_id = $2, assignee_type = $3, assignee_id = $4, blocked_reason = null,
            blocked_on_type = null, blocked_on_id = null
      where id = $1`,
    [row.id, statusId, t.actor.type, t.actor.id],
  );
  await recomputeRollup(t, row.project_id);
  const after = await taskById(t, row.id);
  await audit(t, {
    action: "task.started",
    entityType: "task",
    entityId: row.id,
    projectId: row.project_id,
    before: { status_category: row.status_category },
    after: { status: after.status.name, assignee: after.assignee },
  });
  await emitEvent(t, "task.updated", {
    code: after.code,
    project_code: after.project_code,
    status_category: after.status.category,
  });
  return after;
}

export async function blockTask(
  t: TxCtx,
  code: string,
  input: { reason: string; waiting_on?: AssigneeRef },
): Promise<TaskDto> {
  const row = await lockTask(t, code, "task.transition");
  if (row.status_category === "done") {
    throw conflict(
      `A tarefa ${row.code} está concluída. Reabra antes de bloquear.`,
    );
  }
  assertNoSecrets({ reason: input.reason });
  // Quem destrava: uma pessoa ou um agente do workspace (conferido como o responsável).
  const waiting = input.waiting_on
    ? await resolveAssignee(t, input.waiting_on)
    : null;
  const statusId = await statusByCategory(
    t,
    row.project_id,
    "blocked",
    "Bloqueada",
  );
  await t.tx.query(
    `update ${S}.tasks
        set status_id = $2, blocked_reason = $3, blocked_on_type = $4, blocked_on_id = $5
      where id = $1`,
    [
      row.id,
      statusId,
      input.reason,
      waiting?.type ?? null,
      waiting?.id ?? null,
    ],
  );
  await recomputeRollup(t, row.project_id);
  const after = await taskById(t, row.id);
  await audit(t, {
    action: "task.blocked",
    entityType: "task",
    entityId: row.id,
    projectId: row.project_id,
    before: { status_category: row.status_category },
    after: {
      status: after.status.name,
      blocked_reason: input.reason,
      waiting_on: after.blocked_on?.name ?? null,
    },
  });
  await emitEvent(t, "task.blocked", {
    code: after.code,
    project_code: after.project_code,
    reason: input.reason,
    waiting_on: after.blocked_on,
  });
  // Bloqueio avisa o responsável pelo projeto, a pessoa com a tarefa e quem destrava (com
  // um aviso próprio: "esperando você"); nunca quem bloqueou.
  const owner = await maybeOne<{ id: string | null }>(
    t,
    `select owner_profile_id as id from ${S}.projects where id = $1`,
    [row.project_id],
  );
  const waitingProfile =
    after.blocked_on?.type === "user" ? after.blocked_on.id : null;
  const people = new Set(
    [
      owner?.id ?? null,
      after.assignee?.type === "user" ? after.assignee.id : null,
      waitingProfile,
    ].filter((id): id is string => Boolean(id)),
  );
  for (const profileId of people) {
    await notifyProfile(
      t,
      profileId,
      "task.blocked",
      { type: "task", id: row.id },
      {
        by: t.actor.name,
        task_code: after.code,
        title: after.title,
        project_code: after.project_code,
        reason: input.reason,
        waiting_on_you: profileId === waitingProfile,
      },
    );
  }
  return after;
}

export async function completeTask(
  t: TxCtx,
  code: string,
  input: { evidence: string },
): Promise<TaskDto> {
  const row = await lockTask(t, code, "task.transition");
  if (row.status_category === "done") {
    throw conflict(`A tarefa ${row.code} já está concluída.`);
  }
  if (!input.evidence?.trim()) {
    throw unprocessable(
      "Evidência obrigatória para concluir: informe o SHA do commit, uma URL, um arquivo ou um teste.",
    );
  }
  assertNoSecrets({ evidence: input.evidence });
  const statusId = await statusByCategory(
    t,
    row.project_id,
    "done",
    "Concluída",
  );
  await t.tx.query(
    `update ${S}.tasks
        set status_id = $2, done_evidence = $3, blocked_reason = null,
            blocked_on_type = null, blocked_on_id = null,
            completed_by_type = $4, completed_by_id = $5
      where id = $1`,
    [row.id, statusId, input.evidence, t.actor.type, t.actor.id],
  );
  await recomputeRollup(t, row.project_id);
  const after = await taskById(t, row.id);
  await audit(t, {
    action: "task.completed",
    entityType: "task",
    entityId: row.id,
    projectId: row.project_id,
    before: { status_category: row.status_category },
    after: { status: after.status.name, done_evidence: input.evidence },
  });
  await emitEvent(t, "task.completed", {
    code: after.code,
    project_code: after.project_code,
    evidence: input.evidence,
  });
  return after;
}

export async function reopenTask(
  t: TxCtx,
  code: string,
  input: { reason?: string },
): Promise<TaskDto> {
  const row = await lockTask(t, code, "task.transition");
  if (row.status_category !== "done" && row.status_category !== "blocked") {
    throw conflict(
      `A tarefa ${row.code} não está concluída nem bloqueada; não há o que reabrir.`,
    );
  }
  assertNoSecrets({ reason: input.reason });
  const statusId = await defaultStatus(t, row.project_id);
  await t.tx.query(
    `update ${S}.tasks
        set status_id = $2, blocked_reason = null, done_evidence = null,
            blocked_on_type = null, blocked_on_id = null
      where id = $1`,
    [row.id, statusId],
  );
  if (input.reason) {
    await t.tx.query(
      `insert into ${S}.comments
         (workspace_id, project_id, entity_type, entity_id, body_md, visibility,
          author_type, author_id, author_name, acting_role)
       values ($1, $2, 'task', $3, $4, 'internal', $5, $6, $7, $8)`,
      [
        t.actor.workspaceId,
        row.project_id,
        row.id,
        `Reaberta: ${input.reason}`,
        t.actor.type,
        t.actor.id,
        t.actor.name,
        t.actor.actingRole ?? null,
      ],
    );
  }
  await recomputeRollup(t, row.project_id);
  const after = await taskById(t, row.id);
  await audit(t, {
    action: "task.reopened",
    entityType: "task",
    entityId: row.id,
    projectId: row.project_id,
    before: { status_category: row.status_category },
    after: { status: after.status.name, reason: input.reason ?? null },
  });
  await emitEvent(t, "task.updated", {
    code: after.code,
    project_code: after.project_code,
    status_category: after.status.category,
  });
  return after;
}

/**
 * Arquiva a tarefa e as subtarefas dela: saem das listas, do quadro e do plano, sem ser
 * apagadas, e o histórico continua. A sincronização usa quando o item sai do plan.md.
 */
export async function archiveTask(
  t: TxCtx,
  code: string,
  input: { reason?: string } = {},
): Promise<{ code: string; archived: string[] }> {
  const row = await lockTask(t, code, "task.write");
  assertNoSecrets({ reason: input.reason });
  const archived = (
    await many<{ code: string }>(
      t,
      `update ${S}.tasks set archived_at = now()
        where (id = $1 or parent_task_id = $1) and archived_at is null
        returning code`,
      [row.id],
    )
  ).map((r) => r.code);
  await recomputeRollup(t, row.project_id);
  await audit(t, {
    action: "task.archived",
    entityType: "task",
    entityId: row.id,
    projectId: row.project_id,
    after: { codes: archived, reason: input.reason ?? null },
  });
  return { code: row.code, archived };
}

/**
 * Muda o status pela tela (lista e quadro), escolhendo o caminho de cada destino:
 * concluir exige evidência, bloquear exige o motivo e tarefa concluída é reaberta antes.
 * Cada passo grava a própria atividade. Para pessoas: agentes usam as ações próprias
 * (iniciar, bloquear, concluir), que também aplicam o limite de tarefas em andamento.
 */
export async function moveTask(
  t: TxCtx,
  code: string,
  input: {
    status_id: string;
    evidence?: string;
    reason?: string;
    waiting_on?: AssigneeRef;
  },
  expectedVersion?: number,
): Promise<TaskDto> {
  const row = await lockTask(t, code, "task.transition");
  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    throw preconditionFailed(
      `A tarefa ${row.code} mudou desde a sua leitura (versão atual ${row.version}). Leia de novo e reaplique a mudança.`,
      { current_version: row.version },
    );
  }
  if (!Uuid.safeParse(input.status_id).success) {
    throw badRequest("Status inválido.");
  }
  const target = await maybeOne<{
    id: string;
    name: string;
    category: TaskDto["status"]["category"];
  }>(
    t,
    `select id, name, category from ${S}.task_statuses where id = $1 and project_id = $2`,
    [input.status_id, row.project_id],
  );
  if (!target) throw unprocessable("Esse status não existe neste projeto.");

  const current = await taskById(t, row.id);
  if (current.status.id === target.id) return current;

  if (target.category === "done") {
    return completeTask(t, row.code, {
      evidence: input.evidence?.trim() ?? "",
    });
  }
  if (target.category === "blocked" && !input.reason?.trim()) {
    throw unprocessable("Para bloquear, diga o que falta e de quem depende.");
  }
  if (current.status.category === "done") {
    await reopenTask(t, row.code, {});
  }
  if (target.category === "blocked") {
    return blockTask(t, row.code, {
      reason: input.reason!.trim(),
      waiting_on: input.waiting_on,
    });
  }
  const now = await taskById(t, row.id);
  if (now.status.id === target.id) return now;
  return updateTask(t, row.code, { status: target.name });
}
