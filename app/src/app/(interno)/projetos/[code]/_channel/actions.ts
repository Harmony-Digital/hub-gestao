"use server";

import { refresh } from "next/cache";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { postToClientChannel } from "@/modules/comments/client-channel";
import { inTx } from "@/modules/context";
import { parseReplyForm, type ReplyState } from "./form";

/** A equipe responde no canal do cliente (o cliente vê no portal). Owner e admin. */
export async function responderAoCliente(
  _previous: ReplyState,
  form: FormData,
): Promise<ReplyState> {
  const ctx = await actionContext();
  const parsed = parseReplyForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) =>
      postToClientChannel(t, parsed.value.project, parsed.value.body),
    );
    refresh();
    return {
      status: "ok",
      message: "Mensagem enviada: o cliente vê no portal.",
    };
  } catch (err) {
    return {
      status: "error",
      message: actionErrorMessage(
        err,
        ctx.requestId,
        "Falha ao responder ao cliente.",
      ),
    };
  }
}
