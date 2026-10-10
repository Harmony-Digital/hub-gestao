"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { apiKeyPepper } from "@/lib/env";
import { log } from "@/lib/log";
import {
  currentPortalSession,
  endPortalSession,
  PORTAL_COOKIE,
  portalCookieOptions,
  postPortalComment,
  recordPortalConsent,
  redeemPortalLink,
} from "@/lib/portal/session";
import { noteClientMessage } from "@/modules/comments/client-channel";
import { inTx } from "@/modules/context";
import { systemActor } from "@/modules/jobs/service";
import { parseMessageForm, type MessageState } from "./message-form";

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
