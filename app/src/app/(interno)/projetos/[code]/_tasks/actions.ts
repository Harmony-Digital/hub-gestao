"use server";

import { refresh } from "next/cache";
import { toHubError } from "@/lib/errors";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { createComment } from "@/modules/comments/service";
import { inTx } from "@/modules/context";
import { deleteView, saveView } from "@/modules/views/service";
import { listQuery, readListState } from "./list-state";
import {
  addChecklistItem,
  addDependency,
  removeChecklistItem,
  removeDependency,
  reorderTasks,
  updateChecklistItem,
} from "@/modules/tasks/extras";
import { CreateTaskInput, UpdateTaskInput } from "@/modules/tasks/schemas";
import { addAttachment, removeAttachment } from "@/modules/attachments/service";
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
  parseInlineEdit,
  parseReorderForm,
  parseViewForm,
  parseMoveForm,
  parseNewTaskForm,
  parseTaskFieldsForm,
  parseTimeForm,
  type ActionState,
  type CreateTaskState,
} from "./form";
import { logTime, LogTimeInput } from "@/modules/time/service";
import { formatDuration } from "@/lib/duration";

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

/** Lança tempo na tarefa, em nome de quem está na tela. */
export async function lancarTempo(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseTimeForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { code, minutes, entry_date, note } = parsed.value;
  try {
    await inTx(ctx, (t) =>
      logTime(
        t,
        code,
        LogTimeInput.parse({
          minutes,
          ...(entry_date ? { entry_date } : {}),
          ...(note ? { note } : {}),
        }),
      ),
    );
    refresh();
    return {
      status: "ok",
      message: `${formatDuration(minutes)} lançados em ${code}.`,
    };
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

const TASK = /^[A-Z]{2,6}-[0-9]{1,9}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Anexa um arquivo à tarefa (até 10 MB; o núcleo confere tipo e conteúdo). */
export async function anexarArquivo(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const code = form.get("code");
  const file = form.get("file");
  if (typeof code !== "string" || !TASK.test(code)) {
    return { status: "error", message: "Recarregue a página e tente de novo." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Escolha um arquivo para anexar." };
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await inTx(ctx, (t) => addAttachment(t, code, { name: file.name, bytes }));
    refresh();
    return { status: "ok", message: `${file.name} anexado.` };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function removerAnexo(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const id = form.get("id");
  if (typeof id !== "string" || !ID.test(id)) {
    return { status: "error", message: "Recarregue a página e tente de novo." };
  }
  try {
    await inTx(ctx, (t) => removeAttachment(t, id));
    refresh();
    return { status: "ok" };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/** Edição na linha da Lista: prioridade, responsável, prazo ou status, com a versão lida. */
export async function editarNaLista(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseInlineEdit(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { code, version, change } = parsed.value;
  try {
    await inTx(ctx, (t) =>
      change.field === "status"
        ? moveTask(t, code, { status_id: change.value }, version)
        : updateTask(
            t,
            code,
            UpdateTaskInput.parse({ [change.field]: change.value }),
            version,
          ),
    );
    refresh();
    return { status: "ok" };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/** Salva os filtros atuais com um nome (só os parâmetros válidos, normalizados). */
export async function salvarVisao(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseViewForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { project, type, name, query } = parsed.value;
  const state = readListState(Object.fromEntries(new URLSearchParams(query)));
  try {
    await inTx(ctx, (t) =>
      saveView(t, project, { type, name, query: listQuery(state).toString() }),
    );
    refresh();
    return { status: "ok", message: `Visão “${name}” salva.` };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function apagarVisao(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const id = form.get("id");
  if (typeof id !== "string" || !ID.test(id)) {
    return { status: "error", message: "Recarregue a página e tente de novo." };
  }
  try {
    await inTx(ctx, (t) => deleteView(t, id));
    refresh();
    return { status: "ok" };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/** Grava a ordem de uma coluna do quadro (depois de soltar um cartão). */
export async function reordenarColuna(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseReorderForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) =>
      reorderTasks(t, parsed.value.project, parsed.value.codes),
    );
    refresh();
    return { status: "ok" };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}
