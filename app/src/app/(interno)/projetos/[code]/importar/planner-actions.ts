"use server";

import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { proposePlan } from "@/modules/planner/service";
import type { PlannerState } from "./planner-state";

/** Pede a proposta ao Planejador (PL-11). Nada é gravado: a pessoa revisa e importa. */
export async function proporPlano(
  _previous: PlannerState,
  form: FormData,
): Promise<PlannerState> {
  const ctx = await actionContext();
  const project = form.get("project");
  const document = form.get("document");
  if (typeof project !== "string" || typeof document !== "string") {
    return {
      status: "error",
      message: "Pedido inválido. Recarregue a página.",
    };
  }
  try {
    const result = await proposePlan(ctx, { project, document });
    return result.ok
      ? {
          status: "ok",
          markdown: result.markdown,
          counts: result.counts,
          assumptions: result.assumptions,
          costUsd: result.costUsd,
        }
      : { status: "error", message: result.message };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(err, ctx.requestId, "Falha no Planejador."),
    };
  }
}
