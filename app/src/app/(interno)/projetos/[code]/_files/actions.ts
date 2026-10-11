"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import {
  addClientFile,
  removeClientFile,
} from "@/modules/attachments/client-files";
import { inTx } from "@/modules/context";

const PROJECT = /^[A-Z0-9]{2,8}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Manda um arquivo ao cliente (aparece no portal). Owner e admin. */
export async function enviarArquivoAoCliente(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const project = form.get("project");
  const file = form.get("file");
  if (typeof project !== "string" || !PROJECT.test(project)) {
    return { status: "error", message: "Recarregue a página e tente de novo." };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Escolha o arquivo para mandar." };
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sent = await inTx(ctx, (t) =>
      addClientFile(t, project, { name: file.name, bytes }),
    );
    refresh();
    return {
      status: "ok",
      message: `${sent.filename} entregue: o cliente vê no portal.`,
    };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao mandar o arquivo.",
      ),
    };
  }
}

/** Tira um arquivo entregue (some do portal na hora). */
export async function tirarArquivoDoCliente(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const ctx = await actionContext();
  const id = form.get("id");
  if (typeof id !== "string" || !ID.test(id)) {
    return { status: "error", message: "Recarregue a página e tente de novo." };
  }
  try {
    await inTx(ctx, (t) => removeClientFile(t, id));
    refresh();
    return { status: "ok" };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao tirar o arquivo.",
      ),
    };
  }
}
