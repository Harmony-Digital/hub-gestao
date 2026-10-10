"use server";

import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import {
  archiveClient,
  archiveMilestone,
  archiveProject,
  archiveWorkstream,
  restoreClient,
  restoreMilestone,
  restoreProject,
  restoreWorkstream,
} from "@/modules/archive/service";
import { inTx } from "@/modules/context";
import { parseArchiveForm } from "./form";

/**
 * Arquiva ou restaura marco, frente, projeto ou cliente. Projeto arquivado leva para a
 * página dele, que mostra o aviso e o botão Restaurar.
 */
export async function arquivar(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const parsed = parseArchiveForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { entity, ref, restore } = parsed.value;
  let message: string;
  try {
    message = await inTx(ctx, async (t) => {
      switch (entity) {
        case "milestone": {
          const m = restore
            ? await restoreMilestone(t, ref)
            : await archiveMilestone(t, ref);
          return `${m.code} ${restore ? "restaurado" : "arquivado"}.`;
        }
        case "workstream": {
          const w = restore
            ? await restoreWorkstream(t, ref)
            : await archiveWorkstream(t, ref);
          return `Frente “${w.title}” ${restore ? "restaurada" : "arquivada"}.`;
        }
        case "project": {
          const p = restore
            ? await restoreProject(t, ref)
            : await archiveProject(t, ref);
          return `Projeto ${p.code} ${restore ? "restaurado" : "arquivado"}.`;
        }
        case "client": {
          const c = restore
            ? await restoreClient(t, ref)
            : await archiveClient(t, ref);
          return `Cliente ${c.name} ${restore ? "restaurado" : "arquivado"}.`;
        }
      }
    });
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        restore ? "Falha ao restaurar." : "Falha ao arquivar.",
      ),
    };
  }
  if (entity === "project" && !restore) {
    // O redirecionamento só traz a página nova; a barra lateral (projetos em destaque)
    // também mudou, então o layout vem de novo. Fora do try: o redirect é exceção.
    revalidatePath("/", "layout");
    redirect(`/projetos/${ref}`);
  }
  refresh();
  return { status: "ok", message };
}
