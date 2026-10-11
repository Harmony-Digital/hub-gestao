"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { toHubError } from "@/lib/errors";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  createMilestone,
  CreateMilestoneInput,
  requestMilestoneAcceptance,
  updateMilestone,
  UpdateMilestoneInput,
} from "@/modules/milestones/admin";
import {
  createWorkstream,
  CreateWorkstreamInput,
  getWorkstream,
  setWorkstreamVisibility,
  updateWorkstream,
  UpdateWorkstreamInput,
  WorkstreamVisibilityInput,
} from "@/modules/workstreams/service";
import {
  parseAcceptanceForm,
  parseMilestoneForm,
  parseWorkstreamForm,
  workstreamChanges,
} from "./form";

/** Cria ou edita um marco (camada estratégica). */
export async function salvarMarco(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseMilestoneForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { project, id, input } = parsed.value;
  try {
    const saved = await inTx(ctx, (t) =>
      id
        ? updateMilestone(t, id, UpdateMilestoneInput.parse(input))
        : createMilestone(t, project, CreateMilestoneInput.parse(input)),
    );
    refresh();
    return {
      status: "ok",
      message: id ? `${saved.code} atualizado.` : `${saved.code} criado.`,
    };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(err, ctx.requestId, "Falha ao salvar marco."),
    };
  }
}

/** Pede o aceite do marco: vira um pedido nas Aprovações, que o dono decide. */
export async function pedirAceite(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseAcceptanceForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) => requestMilestoneAcceptance(t, parsed.value.id));
    refresh();
    return { status: "ok", message: "Pedido de aceite enviado." };
  } catch (err) {
    // Pedido igual já pendente (ou marco aceito há pouco): a tela se atualiza e mostra.
    if (toHubError(err).status === 409) refresh();
    return {
      status: "error",
      message: actionErrorMessage(err, ctx.requestId, "Falha ao pedir aceite."),
    };
  }
}

/**
 * Cria ou edita uma frente (camada tática). A parte do cliente só vem no formulário de
 * quem pode decidir (workstream.visibility); o serviço confere de novo.
 */
export async function salvarFrente(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseWorkstreamForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const v = parsed.value;
  try {
    const title = await inTx(ctx, async (t) => {
      const f = v.fields;
      const current = v.id
        ? await getWorkstream(t, v.id)
        : await createWorkstream(
            t,
            CreateWorkstreamInput.parse({
              project: v.project,
              title: f.title,
              milestone: f.milestone ?? undefined,
              department: f.department ?? undefined,
              description_internal: f.description_internal ?? undefined,
              status: f.status,
              assignee: f.assignee ?? undefined,
              depends_on: v.dependsOn?.length ? v.dependsOn : undefined,
            }),
          );
      const changes = workstreamChanges(current, v);
      const update = {
        ...changes.fields,
        ...(changes.dependsOn ? { depends_on: v.dependsOn! } : {}),
      };
      if (v.id && Object.keys(update).length > 0) {
        await updateWorkstream(
          t,
          current.id,
          UpdateWorkstreamInput.parse(update),
        );
      }
      if (v.visibility && changes.visibility) {
        await setWorkstreamVisibility(
          t,
          current.id,
          WorkstreamVisibilityInput.parse(v.visibility),
        );
      }
      return f.title;
    });
    refresh();
    return {
      status: "ok",
      message: v.id
        ? `Frente “${title}” atualizada.`
        : `Frente “${title}” criada.`,
    };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao salvar frente.",
      ),
    };
  }
}
