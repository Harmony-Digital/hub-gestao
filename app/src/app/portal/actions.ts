"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { apiKeyPepper } from "@/lib/env";
import {
  currentPortalSession,
  endPortalSession,
  PORTAL_COOKIE,
  portalCookieOptions,
  recordPortalConsent,
  redeemPortalLink,
} from "@/lib/portal/session";

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
