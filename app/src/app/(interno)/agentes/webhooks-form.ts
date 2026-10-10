import { WEBHOOK_EVENTS, type WebhookEvent } from "@/modules/webhooks/events";

/**
 * Formulários dos webhooks de saída (Sala de Controle): leitura do que chega do
 * navegador e o estado que volta para a tela. Puro, para valer na tela e nos testes.
 */

export type WebhookFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  /** O segredo aparece uma vez só, logo depois de cadastrar ou trocar. */
  | { status: "ok"; message: string; secret?: string };

export const WEBHOOK_IDLE: WebhookFormState = { status: "idle" };

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseNewWebhookForm(
  form: FormData,
): Parsed<{ url: string; events: WebhookEvent[] }> {
  const url = String(form.get("url") ?? "").trim();
  if (!/^https:\/\/\S+$/.test(url)) {
    return { ok: false, message: "Use um endereço que comece com https://." };
  }
  const chosen = new Set(form.getAll("event").map(String));
  const events = WEBHOOK_EVENTS.filter((e) => chosen.has(e));
  if (events.length === 0) {
    return { ok: false, message: "Marque pelo menos um evento." };
  }
  return { ok: true, value: { url, events } };
}

export function parseWebhookIdForm(
  form: FormData,
): Parsed<{ id: string; intent: string }> {
  const id = String(form.get("id") ?? "");
  if (!UUID.test(id)) {
    return { ok: false, message: "Webhook inválido. Recarregue a página." };
  }
  return { ok: true, value: { id, intent: String(form.get("intent") ?? "") } };
}
