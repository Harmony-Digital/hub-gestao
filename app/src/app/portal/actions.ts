"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { appUrl } from "@/lib/auth/config";
import { getDb } from "@/lib/db";
import { emailConfig, sendEmail } from "@/lib/email";
import { apiKeyPepper } from "@/lib/env";
import { log } from "@/lib/log";
import { safeError } from "@/lib/log-safe";
import {
  confirmPortalReceipt,
  currentPortalSession,
  endPortalSession,
  PORTAL_COOKIE,
  portalCookieOptions,
  postPortalComment,
  recordPortalConsent,
  redeemPortalLink,
  REQUESTED_LINK_MINUTES,
  requestPortalLinks,
} from "@/lib/portal/session";
import { requestedLinkEmail } from "@/modules/portal/invite";
import { noteClientMessage } from "@/modules/comments/client-channel";
import { noteReceiptConfirmed } from "@/modules/milestones/receipt";
import { inTx } from "@/modules/context";
import { systemActor } from "@/modules/jobs/service";
import {
  parseLinkRequestForm,
  parseMessageForm,
  type MessageState,
} from "./message-form";

/** Usa o link de uso único: abre a sessão (cookie do portal) e leva ao portal do cliente. */
export async function entrarNoPortal(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const redeemed = await redeemPortalLink(await getDb(), token, apiKeyPepper());
  if (!redeemed) redirect("/portal/sem-acesso");
  (await cookies()).set(
    PORTAL_COOKIE,
    redeemed.sessionToken,
    // O cookie dura o máximo da sessão; quem decide se ela ainda vale é o banco.
    portalCookieOptions(7 * 24 * 3600),
  );
  redirect(`/portal/${redeemed.clientSlug}`);
}

/** Endereço público do Hub (NEXT_PUBLIC_APP_URL); sem ele, só no computador, o do pedido. */
async function linkBase(): Promise<string> {
  const configured = appUrl();
  if (configured) return configured;
  const host = (await headers()).get("host") ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}`;
}

const LINK_REQUESTED = `Se este e-mail tiver acesso liberado ao portal, o link chega em alguns minutos. Ele vale uma vez, por ${REQUESTED_LINK_MINUTES} minutos.`;

/**
 * O contato pede um link novo pelo e-mail (RF-05). A resposta é sempre a mesma, exista
 * ou não o e-mail, e o envio sai depois da resposta: quem pede não descobre quem tem
 * acesso. Só recebe quem o dono já liberou (D9).
 */
export async function pedirLinkPorEmail(
  _previous: MessageState,
  form: FormData,
): Promise<MessageState> {
  const parsed = parseLinkRequestForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  if (!emailConfig()) {
    return {
      status: "error",
      message:
        "O envio do link por e-mail ainda não está ligado. Peça um novo link para quem te convidou.",
    };
  }
  const links = await requestPortalLinks(await getDb(), parsed.value.email, {
    pepper: apiKeyPepper(),
    appUrl: await linkBase(),
  });
  if (links.length) {
    after(async () => {
      for (const link of links) {
        const message = requestedLinkEmail({
          ...link,
          minutes: REQUESTED_LINK_MINUTES,
        });
        try {
          const sent = await sendEmail({
            to: link.email,
            subject: message.subject,
            text: message.text,
            fromName: link.orgName,
          });
          if (!sent.ok)
            log.warn({ reason: sent.reason }, "link pedido: e-mail não saiu");
        } catch (err) {
          log.error({ err: safeError(err) }, "link pedido: e-mail não saiu");
        }
      }
    });
  }
  return { status: "ok", message: LINK_REQUESTED };
}

/** Consentimento LGPD no primeiro acesso. */
export async function aceitarTermos(): Promise<void> {
  const session = await currentPortalSession();
  if (!session) redirect("/portal/sem-acesso");
  await recordPortalConsent(await getDb(), session.sessionHash);
  redirect(`/portal/${session.clientSlug}`);
}

/** Sair: encerra a sessão no banco e apaga o cookie. */
export async function sairDoPortal(): Promise<void> {
  const session = await currentPortalSession();
  if (session) await endPortalSession(await getDb(), session.sessionHash);
  (await cookies()).delete({ name: PORTAL_COOKIE, path: "/portal" });
  redirect("/portal/saiu");
}

const POST_ERROR: Record<
  "no_session" | "not_found" | "invalid" | "too_many",
  string
> = {
  no_session:
    "Sua sessão terminou. Para escrever de novo, peça um novo link para a equipe da Harmony.",
  not_found: "Este projeto não está mais disponível para você.",
  invalid: "A mensagem precisa ter de 1 a 4000 caracteres.",
  too_many:
    "Você mandou muitas mensagens na última hora. Espere um pouco e tente de novo.",
};

/** O contato escreve para a equipe no canal do projeto; a equipe recebe o aviso. */
export async function escreverParaEquipe(
  _previous: MessageState,
  form: FormData,
): Promise<MessageState> {
  const session = await currentPortalSession();
  if (!session) return { status: "error", message: POST_ERROR.no_session };
  const parsed = parseMessageForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const db = await getDb();
  const result = await postPortalComment(
    db,
    session.sessionHash,
    parsed.value.project,
    parsed.value.body,
  );
  if (result.status !== "ok") {
    return { status: "error", message: POST_ERROR[result.status] };
  }
  // A mensagem já está gravada: o aviso à equipe não pode desfazer o envio.
  try {
    await inTx(
      {
        db,
        actor: systemActor(result.workspaceId),
        source: "ui",
        requestId: randomUUID(),
      },
      (t) => noteClientMessage(t, result.commentId),
    );
  } catch (err) {
    log.error({ err, comment: result.commentId }, "aviso do canal do cliente");
  }
  refresh();
  return {
    status: "ok",
    message: "Mensagem enviada. A equipe da Harmony recebeu o aviso.",
  };
}

const RECEIPT_ERROR: Record<
  "no_session" | "not_allowed" | "not_found" | "already",
  string
> = {
  no_session: POST_ERROR.no_session,
  not_allowed:
    "A confirmação de recebimento não está liberada para você neste projeto.",
  not_found: "Esta entrega não está disponível para confirmação.",
  already: "O recebimento desta entrega já foi confirmado.",
};

/** O contato decisor confirma que recebeu uma entrega (não é o aceite, D9). */
export async function confirmarRecebimento(
  _previous: MessageState,
  form: FormData,
): Promise<MessageState> {
  const session = await currentPortalSession();
  if (!session) return { status: "error", message: RECEIPT_ERROR.no_session };
  const project = String(form.get("project") ?? "");
  const milestone = String(form.get("milestone") ?? "");
  if (!/^[A-Z0-9]{2,8}$/.test(project)) {
    return { status: "error", message: RECEIPT_ERROR.not_found };
  }
  const db = await getDb();
  const result = await confirmPortalReceipt(
    db,
    session.sessionHash,
    project,
    milestone,
  );
  if (result.status !== "ok") {
    if (result.status === "already") refresh();
    return { status: "error", message: RECEIPT_ERROR[result.status] };
  }
  try {
    await inTx(
      {
        db,
        actor: systemActor(result.workspaceId),
        source: "ui",
        requestId: randomUUID(),
      },
      (t) => noteReceiptConfirmed(t, result.milestoneId),
    );
  } catch (err) {
    log.error({ err, milestone: result.milestoneId }, "aviso de recebimento");
  }
  refresh();
  return { status: "ok", message: "Recebimento confirmado. Obrigado!" };
}
