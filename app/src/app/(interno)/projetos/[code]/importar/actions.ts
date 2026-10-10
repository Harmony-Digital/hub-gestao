"use server";

import { refresh } from "next/cache";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { importPlan } from "@/modules/sync/service";
import { parseImportForm } from "./form";
import type { ImportState } from "./state";

export async function importarPlano(
  _previous: ImportState,
  form: FormData,
): Promise<ImportState> {
  const ctx = await actionContext();
  const parsed = parseImportForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { project, markdown, intent } = parsed.value;
  try {
    const result = await inTx(ctx, (t) =>
      importPlan(t, { project, markdown, dry_run: intent === "preview" }),
    );
    if (!result.dry_run) refresh();
    return {
      status: "ok",
      sent: markdown,
      result: {
        dryRun: result.dry_run,
        markdown: result.markdown,
        changed: result.changed,
        summary: result.summary,
        milestones: result.milestones,
        conflicts: result.conflicts,
      },
    };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao importar o plan.md.",
      ),
    };
  }
}
