"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { removeClientLogo, setClientLogo } from "@/modules/clients/logo";
import { inTx } from "@/modules/context";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Envia (ou troca) o logo do cliente (RF-04). */
export async function enviarLogoCliente(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const id = form.get("client_id");
  const file = form.get("logo");
  if (typeof id !== "string" || !ID.test(id)) {
    return { status: "error", message: "Recarregue a página e tente de novo." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Escolha a imagem do logo." };
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await inTx(ctx, (t) => setClientLogo(t, id, { name: file.name, bytes }));
    refresh();
    return { status: "ok", message: "Logo atualizado." };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao enviar o logo.",
      ),
    };
  }
}

/** Tira o logo do cliente: o portal volta a mostrar só o nome. */
export async function removerLogoCliente(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const id = form.get("client_id");
  if (typeof id !== "string" || !ID.test(id)) {
    return { status: "error", message: "Recarregue a página e tente de novo." };
  }
  try {
    await inTx(ctx, (t) => removeClientLogo(t, id));
    refresh();
    return { status: "ok", message: "Logo removido." };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao remover o logo.",
      ),
    };
  }
}
