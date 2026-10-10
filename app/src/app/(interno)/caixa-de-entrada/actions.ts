"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  markRead,
  NOTIFICATION_GROUPS,
  setNotificationPref,
} from "@/modules/notifications";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Marca um aviso (campo id) ou todos (campo all) como lidos. */
export async function marcarLidas(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const id = form.get("id");
  const all = form.get("all") === "1";
  if (!all && (typeof id !== "string" || !UUID.test(id))) {
    return { status: "error", message: "Recarregue a página e tente de novo." };
  }
  try {
    await inTx(ctx, (t) => markRead(t, all ? "all" : [id as string]));
    refresh();
    return { status: "ok" };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao marcar avisos.",
      ),
    };
  }
}

/** Liga ou desliga cada grupo de aviso (caixa marcada = recebe). */
export async function salvarPreferencias(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  try {
    await inTx(ctx, async (t) => {
      for (const group of NOTIFICATION_GROUPS) {
        await setNotificationPref(t, group, form.get(group) === "on");
      }
    });
    refresh();
    return { status: "ok", message: "Preferências salvas." };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao salvar preferências.",
      ),
    };
  }
}
