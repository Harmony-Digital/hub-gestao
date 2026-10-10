/**
 * Formulários das tarefas (lista, painel e, depois, o quadro): estados das ações e a
 * leitura do que chega do navegador. Sem dependências de servidor, para valer na tela e
 * nos testes. Quem decide o que é permitido continua sendo o serviço
 * (src/modules/tasks/service.ts).
 */

import type { ActionState } from "@/lib/action-state";

export { IDLE, type ActionState } from "@/lib/action-state";

export type CreateTaskState = ActionState | { status: "created"; code: string };

export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Assignee = { type: "user" | "agent"; id: string } | null;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_CODE = /^[A-Z]{2,6}-[0-9]{1,9}$/;
const PROJECT_CODE = /^[A-Z0-9]{2,8}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

const RELOAD = "Recarregue a página e tente de novo.";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** O navegador envia quebras de linha como \r\n; gravamos \n. */
function multiline(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function taskRef(
  form: FormData,
): Parsed<{ code: string; version: number | undefined }> {
  const code = text(form, "code");
  if (!TASK_CODE.test(code)) return { ok: false, message: RELOAD };
  const raw = text(form, "version");
  const version = raw ? Number(raw) : undefined;
  if (version !== undefined && !Number.isInteger(version)) {
    return { ok: false, message: RELOAD };
  }
  return { ok: true, value: { code, version } };
}

function title(value: string): Parsed<string> {
  const clean = value.trim();
  if (!clean) return { ok: false, message: "Dê um título à tarefa." };
  if (clean.length > 300 || CONTROL.test(clean)) {
    return {
      ok: false,
      message: "O título precisa ter até 300 caracteres, numa linha só.",
    };
  }
  return { ok: true, value: clean };
}

function description(value: string): Parsed<string | null> {
  const clean = multiline(value);
  if (clean.length > 20000) {
    return {
      ok: false,
      message: "A descrição passou de 20 mil caracteres. Encurte o texto.",
    };
  }
  return { ok: true, value: clean || null };
}

function dueDate(value: string): Parsed<string | null> {
  if (!value) return { ok: true, value: null };
  return DATE.test(value)
    ? { ok: true, value }
    : { ok: false, message: "Data inválida. Use o calendário do campo." };
}

function priority(value: string): Parsed<Priority> {
  return (PRIORITIES as readonly string[]).includes(value)
    ? { ok: true, value: value as Priority }
    : { ok: false, message: "Escolha a prioridade." };
}

/** "user:<id>" ou "agent:<id>"; vazio é ninguém. */
export function parseAssignee(value: string): Parsed<Assignee> {
  if (!value) return { ok: true, value: null };
  const m = /^(user|agent):(.+)$/.exec(value);
  if (!m || !UUID.test(m[2])) {
    return { ok: false, message: `Responsável inválido. ${RELOAD}` };
  }
  return {
    ok: true,
    value: { type: m[1] as "user" | "agent", id: m[2].toLowerCase() },
  };
}

/** Valor do campo de responsável para uma pessoa ou agente (vazio é ninguém). */
export function assigneeValue(
  a: { type: string; id: string | null } | null | undefined,
): string {
  return a?.id && (a.type === "user" || a.type === "agent")
    ? `${a.type}:${a.id}`
    : "";
}

function workstream(value: string): Parsed<string | null> {
  if (!value) return { ok: true, value: null };
  return UUID.test(value)
    ? { ok: true, value }
    : { ok: false, message: `Frente inválida. ${RELOAD}` };
}

// Mudança de status ------------------------------------------------------------------

export function parseMoveForm(form: FormData): Parsed<{
  code: string;
  version: number | undefined;
  status_id: string;
  evidence?: string;
  reason?: string;
}> {
  const ref = taskRef(form);
  if (!ref.ok) return ref;
  const statusId = text(form, "status_id");
  if (!UUID.test(statusId)) return { ok: false, message: RELOAD };
  const evidence = multiline(text(form, "evidence"));
  const reason = multiline(text(form, "reason"));
  if (evidence.length > 2000 || reason.length > 2000) {
    return { ok: false, message: "Use até 2 mil caracteres." };
  }
  return {
    ok: true,
    value: {
      ...ref.value,
      status_id: statusId,
      ...(evidence ? { evidence } : {}),
      ...(reason ? { reason } : {}),
    },
  };
}

// Campos da tarefa -------------------------------------------------------------------

/** Campos que a tela edita. Cada formulário manda só os seus; o resto fica como está. */
export type TaskFields = {
  title?: string;
  description_md?: string | null;
  priority?: Priority;
  assignee?: Assignee;
  due_date?: string | null;
  workstream_id?: string | null;
};

export function parseTaskFieldsForm(
  form: FormData,
): Parsed<{ code: string; version: number | undefined; fields: TaskFields }> {
  const ref = taskRef(form);
  if (!ref.ok) return ref;
  const fields: TaskFields = {};
  const steps: [keyof TaskFields, (v: string) => Parsed<unknown>][] = [
    ["title", title],
    ["description_md", description],
    ["priority", priority],
    ["assignee", parseAssignee],
    ["due_date", dueDate],
    ["workstream_id", workstream],
  ];
  for (const [name, parse] of steps) {
    if (!form.has(name)) continue;
    const parsed = parse(text(form, name));
    if (!parsed.ok) return parsed;
    (fields as Record<string, unknown>)[name] = parsed.value;
  }
  return { ok: true, value: { ...ref.value, fields } };
}

type CurrentTask = {
  title: string;
  description_md: string | null;
  priority: string;
  assignee: { type: string; id: string | null } | null;
  due_date: string | null;
  workstream: { id: string } | null;
};

/** Só o que mudou em relação à tarefa como está no banco: o resto não é regravado. */
export function changedTaskFields(
  current: CurrentTask,
  fields: TaskFields,
): TaskFields {
  const changes: TaskFields = {};
  if (fields.title !== undefined && fields.title !== current.title) {
    changes.title = fields.title;
  }
  if (
    fields.description_md !== undefined &&
    fields.description_md !== (current.description_md?.trim() || null)
  ) {
    changes.description_md = fields.description_md;
  }
  if (fields.priority !== undefined && fields.priority !== current.priority) {
    changes.priority = fields.priority;
  }
  if (
    fields.assignee !== undefined &&
    assigneeValue(fields.assignee) !== assigneeValue(current.assignee)
  ) {
    changes.assignee = fields.assignee;
  }
  if (fields.due_date !== undefined && fields.due_date !== current.due_date) {
    changes.due_date = fields.due_date;
  }
  if (
    fields.workstream_id !== undefined &&
    fields.workstream_id !== (current.workstream?.id ?? null)
  ) {
    changes.workstream_id = fields.workstream_id;
  }
  return changes;
}

// Comentário -------------------------------------------------------------------------

export function parseCommentForm(
  form: FormData,
): Parsed<{ code: string; body_md: string }> {
  const ref = taskRef(form);
  if (!ref.ok) return ref;
  const body = multiline(text(form, "body"));
  if (!body) return { ok: false, message: "Escreva o comentário." };
  if (body.length > 10000) {
    return {
      ok: false,
      message: "O comentário passou de 10 mil caracteres. Divida em partes.",
    };
  }
  return { ok: true, value: { code: ref.value.code, body_md: body } };
}

// Nova tarefa ------------------------------------------------------------------------

export function parseNewTaskForm(form: FormData): Parsed<{
  project: string;
  title: string;
  description_md?: string;
  priority: Priority;
  assignee?: { type: "user" | "agent"; id: string };
  due_date?: string;
  workstream_id?: string;
}> {
  const project = text(form, "project");
  if (!PROJECT_CODE.test(project)) return { ok: false, message: RELOAD };
  const parts = {
    title: title(text(form, "title")),
    description: description(text(form, "description_md")),
    priority: priority(text(form, "priority") || "normal"),
    assignee: parseAssignee(text(form, "assignee")),
    due: dueDate(text(form, "due_date")),
    workstream: workstream(text(form, "workstream_id")),
  };
  for (const part of Object.values(parts)) {
    if (!part.ok) return part;
  }
  const value = (p: Parsed<unknown>) => (p.ok ? p.value : null);
  const d = value(parts.description) as string | null;
  const a = value(parts.assignee) as Assignee;
  const due = value(parts.due) as string | null;
  const ws = value(parts.workstream) as string | null;
  return {
    ok: true,
    value: {
      project,
      title: value(parts.title) as string,
      priority: value(parts.priority) as Priority,
      ...(d ? { description_md: d } : {}),
      ...(a ? { assignee: a } : {}),
      ...(due ? { due_date: due } : {}),
      ...(ws ? { workstream_id: ws } : {}),
    },
  };
}

// Checklist e dependências ------------------------------------------------------------

export type ChecklistRequest =
  | { op: "add"; code: string; text: string }
  | { op: "toggle"; id: string; done: boolean }
  | { op: "rename"; id: string; text: string }
  | { op: "remove"; id: string };

function checklistText(value: string): Parsed<string> {
  const clean = value.trim();
  if (!clean) return { ok: false, message: "Escreva o item do checklist." };
  if (clean.length > 300 || CONTROL.test(clean)) {
    return {
      ok: false,
      message: "Cada item do checklist: até 300 caracteres, numa linha só.",
    };
  }
  return { ok: true, value: clean };
}

export function parseChecklistForm(form: FormData): Parsed<ChecklistRequest> {
  const op = text(form, "op");
  if (op === "add") {
    const code = text(form, "code");
    if (!TASK_CODE.test(code)) return { ok: false, message: RELOAD };
    const item = checklistText(text(form, "text"));
    if (!item.ok) return item;
    return { ok: true, value: { op, code, text: item.value } };
  }
  const id = text(form, "id");
  if (!UUID.test(id)) return { ok: false, message: RELOAD };
  if (op === "toggle") {
    const done = text(form, "done");
    if (done !== "true" && done !== "false") {
      return { ok: false, message: RELOAD };
    }
    return { ok: true, value: { op, id, done: done === "true" } };
  }
  if (op === "rename") {
    const item = checklistText(text(form, "text"));
    if (!item.ok) return item;
    return { ok: true, value: { op, id, text: item.value } };
  }
  if (op === "remove") return { ok: true, value: { op, id } };
  return { ok: false, message: RELOAD };
}

export function parseDependencyForm(
  form: FormData,
): Parsed<{ op: "add" | "remove"; code: string; other: string }> {
  const op = text(form, "op");
  const code = text(form, "code");
  if ((op !== "add" && op !== "remove") || !TASK_CODE.test(code)) {
    return { ok: false, message: RELOAD };
  }
  const other = text(form, "other").trim().toUpperCase();
  if (!TASK_CODE.test(other)) {
    return {
      ok: false,
      message: "Informe o código da tarefa de que esta depende, como HUB-12.",
    };
  }
  if (other === code) {
    return { ok: false, message: `${code} não pode depender de si mesma.` };
  }
  return { ok: true, value: { op, code, other } };
}
