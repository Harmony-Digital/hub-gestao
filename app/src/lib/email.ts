import { log } from "@/lib/log";

/**
 * E-mail pelo Resend (PRD RF-33; D9): o convite do portal e, quando o projeto pede, o
 * aviso de relatório publicado para os contatos do cliente. Falha fechada: sem
 * `RESEND_API_KEY` e `HUB_EMAIL_FROM` no servidor, nada sai, e quem chama mostra o motivo
 * (o dono continua podendo copiar o convite). Nunca registra endereço, assunto nem corpo:
 * é dado pessoal e, no convite, leva o link de uso único.
 */

export type EmailConfig = {
  apiKey: string;
  /** Endereço do remetente, com o domínio verificado no Resend (ex.: hub@dominio). */
  from: string;
  replyTo: string | null;
};

export function emailConfig(
  env: Record<string, string | undefined> = process.env,
): EmailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.HUB_EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return { apiKey, from, replyTo: env.HUB_EMAIL_REPLY_TO?.trim() || null };
}

export type EmailMessage = {
  to: string;
  subject: string;
  /** Só texto: sem HTML, nada do que vem de pessoa vira marcação. */
  text: string;
  /** Mesmo pedido repetido em até 24 horas não sai duas vezes (cabeçalho do Resend). */
  idempotencyKey?: string;
  /** Nome que aparece como remetente: o do workspace (nada fixo no código). */
  fromName?: string;
};

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: "off" | "invalid" | "provider"; detail: string };

export const EMAIL_OFF =
  "O envio de e-mail está desligado: falta configurar o Resend no servidor (docs/email.md).";

const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const CONTROL = /[\u0000-\u001F\u007F]/;
const RESEND_URL = "https://api.resend.com/emails";

/** "Nome <endereço>", com o nome limpo; se o servidor já trouxer o nome, fica o dele. */
export function fromHeader(address: string, name?: string): string {
  if (address.includes("<")) return address;
  const clean = (name ?? "").replace(/["<>\\\u0000-\u001F\u007F]/g, "").trim();
  return clean ? `${clean} <${address}>` : address;
}

export async function sendEmail(
  message: EmailMessage,
  deps: {
    config?: EmailConfig | null;
    fetch?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<EmailResult> {
  const config = deps.config === undefined ? emailConfig() : deps.config;
  if (!config) return { ok: false, reason: "off", detail: EMAIL_OFF };
  const to = message.to.trim();
  const subject = message.subject.trim();
  if (!ADDRESS.test(to) || to.length > 254) {
    return {
      ok: false,
      reason: "invalid",
      detail: "E-mail do destinatário inválido.",
    };
  }
  if (!subject || subject.length > 200 || CONTROL.test(subject)) {
    return { ok: false, reason: "invalid", detail: "Assunto inválido." };
  }
  if (!message.text.trim() || message.text.length > 20_000) {
    return {
      ok: false,
      reason: "invalid",
      detail: "Mensagem vazia ou longa demais.",
    };
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.apiKey}`,
    "content-type": "application/json",
  };
  if (message.idempotencyKey) {
    headers["idempotency-key"] = message.idempotencyKey.slice(0, 256);
  }
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(RESEND_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: fromHeader(config.from, message.fromName),
        to: [to],
        subject,
        text: message.text,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
    });
  } catch {
    log.warn({ provider: "resend" }, "e-mail: o Resend não respondeu");
    return {
      ok: false,
      reason: "provider",
      detail: "O serviço de e-mail não respondeu. Tente de novo em instantes.",
    };
  }
  if (!response.ok) {
    log.warn(
      { provider: "resend", status: response.status },
      "e-mail recusado",
    );
    return {
      ok: false,
      reason: "provider",
      detail: `O serviço de e-mail recusou o envio (HTTP ${response.status}).`,
    };
  }
  const body = (await response.json().catch(() => null)) as {
    id?: unknown;
  } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  log.info({ provider: "resend", email_id: id }, "e-mail enviado");
  return { ok: true, id };
}
