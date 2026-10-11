"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { refresh } from "next/cache";
import { appUrl } from "@/lib/auth/config";
import { sendEmail } from "@/lib/email";
import { apiKeyPepper } from "@/lib/env";
import { formatTimestampDay } from "@/lib/format";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { Uuid } from "@/modules/common";
import {
  createContact,
  inviteEmailTarget,
  issuePortalLink,
  noteInviteEmailed,
  revokePortalAccess,
} from "@/modules/portal/access";
import { inviteHasLink, inviteMessage } from "@/modules/portal/invite";
import {
  anonymizeClientContacts,
  anonymizeContact,
} from "@/modules/privacy/service";
import {
  parseContactForm,
  parseContactIdForm,
  type PortalFormState,
} from "./form";

const failure = (err: unknown, requestId: string): PortalFormState => ({
  status: "error",
  message: actionErrorMessage(err, requestId, "Falha no acesso ao portal."),
});

/** Endereço público do Hub (NEXT_PUBLIC_APP_URL); sem ele, só no computador, o do pedido. */
async function linkBase(): Promise<string> {
  const configured = appUrl();
  if (configured) return configured;
  const host = (await headers()).get("host") ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}`;
}

export async function criarContato(
  _previous: PortalFormState,
  form: FormData,
): Promise<PortalFormState> {
  const ctx = await actionContext();
  const parsed = parseContactForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const { clientId, ...input } = parsed.value;
  try {
    await inTx(ctx, (t) => createContact(t, clientId, input));
    refresh();
    return {
      status: "ok",
      message: `${input.name} cadastrado, ainda sem acesso ao portal.`,
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/** Libera o acesso (ou gera um link novo): o link aparece uma vez, para o dono copiar. */
export async function gerarLinkPortal(
  _previous: PortalFormState,
  form: FormData,
): Promise<PortalFormState> {
  const ctx = await actionContext();
  const parsed = parseContactIdForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  const base = await linkBase();
  try {
    const issued = await inTx(ctx, (t) =>
      issuePortalLink(t, parsed.value, {
        pepper: apiKeyPepper(),
        appUrl: base,
      }),
    );
    refresh();
    return {
      status: "ok",
      message: `${issued.released ? "Acesso liberado." : "Link novo gerado; o anterior não vale mais."} Copie o link e mande ao contato por onde preferir: ele vale uma vez, até ${formatTimestampDay(issued.expiresAt)}, e não aparece de novo.`,
      link: issued.url,
      invite: inviteMessage({
        ...issued.invite,
        url: issued.url,
        until: formatTimestampDay(issued.expiresAt),
      }),
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/**
 * O convite por e-mail, pelo Hub (D9), com a mensagem que o dono revisou. Chamado direto
 * do botão "Enviar por e-mail": o link de uso único vai na mensagem, e o histórico guarda
 * só o envio. A chave de repetição vem do link: clicar duas vezes não manda dois e-mails.
 */
export async function enviarConvitePorEmail(input: {
  contactId: string;
  link: string;
  text: string;
}): Promise<PortalFormState> {
  const ctx = await actionContext();
  if (!Uuid.safeParse(input.contactId).success) {
    return {
      status: "error",
      message: "Contato não encontrado. Recarregue a página.",
    };
  }
  const text = input.text.trim();
  if (!inviteHasLink(text, input.link, await linkBase())) {
    return {
      status: "error",
      message:
        "A mensagem precisa ter o link de acesso. Gere um link novo se apagou sem querer.",
    };
  }
  try {
    const target = await inTx(ctx, (t) =>
      inviteEmailTarget(t, input.contactId),
    );
    const sent = await sendEmail({
      to: target.email,
      subject: target.orgName
        ? `Seu acesso ao portal da ${target.orgName}`
        : "Seu acesso ao portal",
      text,
      fromName: target.orgName,
      idempotencyKey: `convite-${createHash("sha256").update(input.link).digest("hex")}`,
    });
    if (!sent.ok) return { status: "error", message: sent.detail };
    await inTx(ctx, (t) => noteInviteEmailed(t, input.contactId, sent.id));
    return {
      status: "ok",
      message: `Convite enviado por e-mail para ${target.email}.`,
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

export async function revogarAcessoPortal(
  _previous: PortalFormState,
  form: FormData,
): Promise<PortalFormState> {
  const ctx = await actionContext();
  const parsed = parseContactIdForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    await inTx(ctx, (t) => revokePortalAccess(t, parsed.value));
    refresh();
    return {
      status: "ok",
      message:
        "Acesso revogado: as sessões abertas e os links pendentes não valem mais.",
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/** Exclui os dados pessoais do contato (LGPD). Não tem volta. Só o dono. */
export async function excluirDadosContato(
  _previous: PortalFormState,
  form: FormData,
): Promise<PortalFormState> {
  const ctx = await actionContext();
  const parsed = parseContactIdForm(form);
  if (!parsed.ok) return { status: "error", message: parsed.message };
  try {
    const result = await inTx(ctx, (t) => anonymizeContact(t, parsed.value));
    refresh();
    return {
      status: "ok",
      message: result.already
        ? "Os dados pessoais deste contato já tinham sido excluídos."
        : `Dados pessoais excluídos: nome, e-mail, acesso e ${result.messages === 1 ? "1 mensagem" : `${result.messages} mensagens`} no portal.`,
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}

/** Fim do contrato: exclui os dados pessoais de todos os contatos do cliente. Só o dono. */
export async function excluirDadosCliente(
  _previous: PortalFormState,
  form: FormData,
): Promise<PortalFormState> {
  const ctx = await actionContext();
  const clientId = String(form.get("client_id") ?? "");
  try {
    const result = await inTx(ctx, (t) => anonymizeClientContacts(t, clientId));
    refresh();
    return {
      status: "ok",
      message:
        result.contacts === 0
          ? "Nenhum contato com dados pessoais para excluir."
          : `Dados pessoais excluídos de ${result.contacts === 1 ? "1 contato" : `${result.contacts} contatos`}.`,
    };
  } catch (err) {
    return failure(err, ctx.requestId);
  }
}
