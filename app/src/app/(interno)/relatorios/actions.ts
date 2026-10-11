"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { draftReport } from "@/modules/reports/service";
import { periodFacts } from "@/modules/reports/summary";
import { renderSummary } from "@/modules/reports/summary-text";
import { parseReportForm } from "./form";

export type SummaryState =
  | { status: "idle" }
  | { status: "ok"; text: string }
  | { status: "error"; message: string };

/** Monta o resumo do período com o que o Hub registrou (sem IA); nada é gravado. */
export async function montarResumo(form: FormData): Promise<SummaryState> {
  const ctx = await actionContext();
  const parsed = parseReportForm(form, { needBody: false });
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { project, start, end, audience } = parsed.value;
  try {
    const facts = await inTx(ctx, (t) => periodFacts(t, project, start, end));
    return { status: "ok", text: renderSummary(facts, audience, start, end) };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao montar o resumo.",
      ),
    };
  }
}

/** Manda o relatório para as Aprovações (o dono aprova; aprovar publica). */
export async function prepararRelatorio(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseReportForm(form, { needBody: true });
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { project, start, end, audience, body } = parsed.value;
  try {
    await inTx(ctx, (t) =>
      draftReport(t, {
        project,
        period_start: start,
        period_end: end,
        audience,
        body_md: body,
      }),
    );
    refresh();
    return {
      status: "ok",
      message: "Relatório mandado para as Aprovações.",
    };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao preparar o relatório.",
      ),
    };
  }
}
