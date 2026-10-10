"use server";

import { refresh } from "next/cache";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  createWebhook,
  rotateWebhookSecret,
  sendWebhookTest,
  setWebhookActive,
} from "@/modules/webhooks/service";
import {
  parseNewWebhookForm,
  parseWebhookIdForm,
  type WebhookFormState,
} from "./webhooks-form";

const failure = (err: unknown, requestId: string): WebhookFormState => ({
  status: "error",
  message: actionErrorMessage(err, requestId, "Falha nos webhooks."),
});

/** Cadastra o webhook; o segredo volta uma vez só, para colar no sistema que recebe. */
export async function cadastrarWebhook(
  _previous: WebhookFormState,
  form: FormData,
): Promise<WebhookFormState> {
  const ctx = await actionContext();
  const parsed = parseNewWebhookForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const { secret } = await inTx(ctx, (t) => createWebhook(t, parsed.value));
    refresh();
    return {
      status: "ok",
      message:
        "Webhook cadastrado. Copie o segredo agora e cole no sistema que recebe: o Hub não mostra de novo.",
      secret,
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/** Troca o segredo (o antigo para de valer na hora); o novo volta uma vez só. */
export async function trocarSegredoWebhook(
  _previous: WebhookFormState,
  form: FormData,
): Promise<WebhookFormState> {
  const ctx = await actionContext();
  const parsed = parseWebhookIdForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const { secret } = await inTx(ctx, (t) =>
      rotateWebhookSecret(t, parsed.value.id),
    );
    refresh();
    return {
      status: "ok",
      message:
        "Segredo trocado: o antigo já não vale. Copie o novo agora e atualize o sistema que recebe.",
      secret,
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/** Pausar, reativar ou mandar um aviso de teste. */
export async function mudarWebhook(
  _previous: WebhookFormState,
  form: FormData,
): Promise<WebhookFormState> {
  const ctx = await actionContext();
  const parsed = parseWebhookIdForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { id, intent } = parsed.value;
  try {
    if (intent === "testar") {
      await inTx(ctx, (t) => sendWebhookTest(t, id));
      refresh();
      return {
        status: "ok",
        message:
          "Teste na fila: sai em até cinco minutos (na próxima volta do relógio do Hub). Atualize a tela para ver se chegou.",
      };
    }
    if (intent !== "pausar" && intent !== "reativar") {
      return { status: "error", message: "Pedido inválido." };
    }
    await inTx(ctx, (t) => setWebhookActive(t, id, intent === "reativar"));
    refresh();
    return {
      status: "ok",
      message:
        intent === "pausar"
          ? "Webhook pausado: nada sai até reativar."
          : "Webhook reativado.",
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}
