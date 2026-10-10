"use server";

import { refresh } from "next/cache";
import { toHubError } from "@/lib/errors";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { createComment } from "@/modules/comments/service";
import { inTx } from "@/modules/context";
import {
  addChecklistItem,
  addDependency,
  removeChecklistItem,
  removeDependency,
  updateChecklistItem,
} from "@/modules/tasks/extras";
import { CreateTaskInput, UpdateTaskInput } from "@/modules/tasks/schemas";
import {
  createTask,
  getTask,
  moveTask,
  updateTask,
} from "@/modules/tasks/service";
import {
  changedTaskFields,
  parseChecklistForm,
  parseCommentForm,
  parseDependencyForm,
  parseMoveForm,
  parseNewTaskForm,
  parseTaskFieldsForm,
  type ActionState,
  type CreateTaskState,
} from "./form";

const STALE =
  "Esta tarefa mudou enquanto você olhava (uma pessoa ou um agente atualizou). A tela já mostra a versão nova: confira e faça a alteração de novo.";

function failure(err: unknown, requestId: string): ActionState {
  if (toHubError(err).status === 412) {
    refresh();
    return { status: "error", message: STALE };
  }
  return {
    status: "error",
    message: actionErrorMessage(err, requestId, "Falha numa ação de tarefa."),
  };
}

export async function mudarStatus(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseMoveForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { code, version, ...input } = parsed.value;
  try {
    const task = await inTx(ctx, (t) => moveTask(t, code, input, version));
    refresh();
    return {
      status: "ok",
      message: `${task.code} está em ${task.status.name}.`,
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function salvarTarefa(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseTaskFieldsForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { code, version, fields } = parsed.value;
  try {
    const saved = await inTx(ctx, async (t) => {
      const current = await getTask(t, code);
      const changes = changedTaskFields(current, fields);
      if (Object.keys(changes).length === 0) return false;
      await updateTask(t, code, UpdateTaskInput.parse(changes), version);
      return true;
    });
    if (saved) refresh();
    return { status: "ok", message: saved ? "Alteração salva." : undefined };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function comentarTarefa(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseCommentForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { code, body_md, mentions } = parsed.value;
  try {
    await inTx(ctx, (t) =>
      createComment(t, { task: code }, { body_md, mentions }),
    );
    refresh();
    return { status: "ok" };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function criarTarefa(
  _previous: CreateTaskState,
  form: FormData,
): Promise<CreateTaskState> {
  const ctx = await actionContext();
  const parsed = parseNewTaskForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const task = await inTx(ctx, (t) =>
      createTask(t, CreateTaskInput.parse(parsed.value)),
    );
    refresh();
    return { status: "created", code: task.code };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/** Checklist da tarefa: adicionar, marcar ou desmarcar, renomear e remover. */
export async function checklistTarefa(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseChecklistForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const v = parsed.value;
  try {
    await inTx(ctx, async (t) => {
      if (v.op === "add") await addChecklistItem(t, v.code, v.text);
      else if (v.op === "toggle") {
        await updateChecklistItem(t, v.id, { done: v.done });
      } else if (v.op === "rename") {
        await updateChecklistItem(t, v.id, { text: v.text });
      } else await removeChecklistItem(t, v.id);
    });
    refresh();
    return { status: "ok" };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/** Dependência: a tarefa passa a depender de outra (ou deixa de depender). */
export async function dependenciaTarefa(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseDependencyForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { op, code, other } = parsed.value;
  try {
    await inTx(ctx, (t) =>
      op === "add"
        ? addDependency(t, code, other)
        : removeDependency(t, code, other),
    );
    refresh();
    return { status: "ok" };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}
