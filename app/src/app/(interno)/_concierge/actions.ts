"use server";

import { refresh } from "next/cache";
import { can } from "@/lib/authorize";
import { toHubError } from "@/lib/errors";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { getApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import {
  executeConcierge,
  interpretRequest,
} from "@/modules/concierge/service";
import { decisionView } from "../_approvals/view";
import { parseConciergeForm } from "./form";
import type { ConfirmState, InterpretState } from "./state";

/** Interpreta o pedido (texto ou ditado) e devolve a prévia. Nada é gravado aqui. */
export async function interpretarPedido(input: {
  text: string;
  path: string;
}): Promise<InterpretState> {
  const ctx = await actionContext();
  try {
    const result = await interpretRequest(ctx, {
      text: String(input?.text ?? ""),
      path: String(input?.path ?? ""),
    });
    if (!result.ok) return result;
    const proposal = result.proposal;
    if (proposal.kind !== "approval") return { ok: true, view: proposal };
    // Pedido de aprovação: o cartão de decisão de sempre; quem decide é a pessoa.
    const view = await inTx(ctx, async (t) => ({
      kind: "approval" as const,
      item: decisionView(await getApproval(t, proposal.approvalId), new Date()),
      canDecide: can(t.actor, "approval.decide"),
    }));
    return { ok: true, view };
  } catch (err) {
    return {
      ok: false,
      message: actionErrorMessage(err, ctx.requestId, "Falha no Concierge."),
    };
  }
}

/** Executa o que a pessoa confirmou na prévia (talvez editado), em nome dela. */
export async function confirmarConcierge(
  _previous: ConfirmState,
  form: FormData,
): Promise<ConfirmState> {
  const ctx = await actionContext();
  const parsed = parseConciergeForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const done = await executeConcierge(ctx, parsed.command, parsed.meta);
    refresh();
    return {
      status: "done",
      message: done.message,
      code: done.code,
      href: `/projetos/${done.project_code}/lista?tarefa=${done.code}`,
      created: parsed.command.kind === "create_task",
    };
  } catch (err) {
    if (toHubError(err).status === 412) {
      return {
        status: "error",
        message:
          "A tarefa mudou desde a prévia. Peça de novo ao Concierge para ver a versão atual.",
      };
    }
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao executar o pedido do Concierge.",
      ),
    };
  }
}
