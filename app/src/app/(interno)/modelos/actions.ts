"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  createTemplate,
  removeTemplate,
  templateFromProject,
  TemplateInput,
  updateTemplate,
} from "@/modules/templates/service";
import {
  parseProjectTemplateForm,
  parseRemoveTemplateForm,
  parseTemplateForm,
} from "./form";

/** Cria ou edita um modelo de projeto (dono e administração). */
export async function salvarModelo(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseTemplateForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { id, input } = parsed.value;
  try {
    const saved = await inTx(ctx, (t) =>
      id
        ? updateTemplate(t, id, TemplateInput.parse(input))
        : createTemplate(t, TemplateInput.parse(input)),
    );
    refresh();
    return {
      status: "ok",
      message: id
        ? `Modelo “${saved.name}” salvo.`
        : `Modelo “${saved.name}” criado.`,
    };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao salvar modelo.",
      ),
    };
  }
}

export async function removerModelo(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseRemoveTemplateForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const { name } = await inTx(ctx, (t) => removeTemplate(t, parsed.value.id));
    refresh();
    return { status: "ok", message: `Modelo “${name}” removido.` };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao remover modelo.",
      ),
    };
  }
}

/** Salva o esqueleto de um projeto como modelo (Editar projeto). */
export async function salvarComoModelo(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseProjectTemplateForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const v = parsed.value;
  try {
    const saved = await inTx(ctx, (t) =>
      templateFromProject(t, v.project, {
        name: v.name,
        description: v.description,
      }),
    );
    refresh();
    return {
      status: "ok",
      message: `Modelo “${saved.name}” criado com ${saved.counts.milestones} marcos e ${saved.counts.tasks} tarefas. Ele está em Modelos de projeto.`,
    };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(err, ctx.requestId, "Falha ao criar modelo."),
    };
  }
}
