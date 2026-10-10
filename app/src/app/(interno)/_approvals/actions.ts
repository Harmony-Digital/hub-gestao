"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { toHubError } from "@/lib/errors";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { decideApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import { decisionMessage, parseDecisionForm } from "./view";

/** Decisão do dono sobre um pedido (D9). O serviço confere a permissão e aplica o efeito. */
export async function decidirPedido(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseDecisionForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { id, decision, note } = parsed.value;
  try {
    const decided = await inTx(ctx, (t) =>
      decideApproval(t, id, { decision, note }),
    );
    refresh();
    return { status: "ok", message: decisionMessage(decided) };
  } catch (err) {
    if (toHubError(err).status === 409) {
      refresh();
      return {
        status: "error",
        message:
          "Este pedido já foi decidido ou cancelado em outro lugar. A tela foi atualizada.",
      };
    }
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao decidir um pedido.",
      ),
    };
  }
}
