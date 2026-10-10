"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { appUrl } from "@/lib/auth/config";
import { apiKeyPepper } from "@/lib/env";
import { formatTimestampDay } from "@/lib/format";
import { actionContext, actionErrorMessage } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  createContact,
  issuePortalLink,
  revokePortalAccess,
} from "@/modules/portal/access";
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
