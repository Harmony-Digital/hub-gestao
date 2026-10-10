"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  createStatus,
  removeStatus,
  reorderStatuses,
  updateStatus,
} from "@/modules/tasks/statuses";
import {
  parseCreateStatusForm,
  parseRemoveStatusForm,
  parseReorderStatusForm,
  parseUpdateStatusForm,
} from "./status-form";

const failure = (err: unknown, requestId: string): ActionState => ({
  status: "error",
  message: actionErrorMessage(err, requestId, "Falha no editor de status."),
});

export async function criarStatus(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseCreateStatusForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { project, ...input } = parsed.value;
  try {
    const created = await inTx(ctx, (t) => createStatus(t, project, input));
    refresh();
    return { status: "ok", message: `Status "${created.name}" criado.` };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function salvarStatus(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseUpdateStatusForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) =>
      updateStatus(t, parsed.value.id, parsed.value.input),
    );
    refresh();
    return { status: "ok" };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function ordenarStatus(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseReorderStatusForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) =>
      reorderStatuses(t, parsed.value.project, parsed.value.ids),
    );
    refresh();
    return { status: "ok" };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function removerStatus(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseRemoveStatusForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) =>
      removeStatus(t, parsed.value.id, parsed.value.moveTo),
    );
    refresh();
    return { status: "ok" };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}
