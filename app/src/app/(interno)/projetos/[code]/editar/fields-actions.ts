"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  createField,
  CustomFieldInput,
  removeField,
  updateField,
} from "@/modules/tasks/custom-fields";
import {
  parseCreateFieldForm,
  parseRemoveFieldForm,
  parseUpdateFieldForm,
} from "./fields-form";

const failure = (err: unknown, requestId: string): ActionState => ({
  status: "error",
  message: actionErrorMessage(err, requestId, "Falha nos campos das tarefas."),
});

export async function criarCampo(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseCreateFieldForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { project, ...input } = parsed.value;
  try {
    const created = await inTx(ctx, (t) =>
      createField(t, project, CustomFieldInput.parse(input)),
    );
    refresh();
    return { status: "ok", message: `Campo “${created.name}” criado.` };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function salvarCampo(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseUpdateFieldForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { id, ...input } = parsed.value;
  try {
    const saved = await inTx(ctx, (t) => updateField(t, id, input));
    refresh();
    return { status: "ok", message: `Campo “${saved.name}” salvo.` };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function removerCampo(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseRemoveFieldForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const { name } = await inTx(ctx, (t) => removeField(t, parsed.value.id));
    refresh();
    return { status: "ok", message: `Campo “${name}” removido.` };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}
