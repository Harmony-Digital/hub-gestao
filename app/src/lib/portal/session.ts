import "server-only";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { applyRuntimeRole, type ClientActor } from "@/lib/db/actor";
import type { Db } from "@/lib/db/types";
import { apiKeyPepper } from "@/lib/env";
import { generatePortalToken, hashPortalToken, PORTAL_TOKEN } from "./token";

/**
 * Sessão do portal do cliente (D9): nasce do link de uso único que o dono gera e vive
 * num cookie só do portal (HttpOnly, caminho /portal), por poucas horas. No banco fica
 * só o hash. Quem é o contato vem de funções SECURITY DEFINER da migração 0015, porque
 * a sessão é lida antes de existir contexto de ator; depois, tudo no portal roda com o
 * ator de cliente, e a RLS só mostra o que é do cliente e está marcado para ele.
 */

export const PORTAL_COOKIE = "hub_portal";
export const PORTAL_SESSION_HOURS = 12;

export type PortalSession = {
  actor: ClientActor;
  clientSlug: string;
  clientName: string;
  contactName: string;
  consentAt: string | null;
  /** Hash da sessão, para o consentimento e a saída. */
  sessionHash: string;
};

/** Consulta sem contexto de ator, no papel do app (as funções conferem tudo). */
async function bare<T extends Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await applyRuntimeRole(db, tx);
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** Resgata o link (uma vez): o slug do cliente e o valor da sessão nova, ou null. */
export async function redeemPortalLink(
  db: Db,
  token: string,
  pepper: string,
): Promise<{ clientSlug: string; sessionToken: string } | null> {
  if (!PORTAL_TOKEN.test(token)) return null;
  const sessionToken = generatePortalToken();
  const rows = await bare<{ client_slug: string }>(
    db,
    `select client_slug from proj_hub_gestao.redeem_client_access_link($1, $2, $3)`,
    [
      hashPortalToken(token, pepper),
      hashPortalToken(sessionToken, pepper),
      PORTAL_SESSION_HOURS,
    ],
  );
  return rows[0] ? { clientSlug: rows[0].client_slug, sessionToken } : null;
}

type SessionRow = {
  workspace_id: string;
  contact_id: string;
  profile_id: string;
  client_id: string;
  client_slug: string;
  client_name: string;
  contact_name: string;
  contact_role: "client_viewer" | "client_approver";
  consent_at: Date | string | null;
};

/** O contato da sessão (cookie), ou null se ela venceu, foi encerrada ou revogada. */
export async function portalSessionFromToken(
  db: Db,
  token: string,
  pepper: string,
): Promise<PortalSession | null> {
  if (!PORTAL_TOKEN.test(token)) return null;
  const sessionHash = hashPortalToken(token, pepper);
  const row = (
    await bare<SessionRow>(
      db,
      `select * from proj_hub_gestao.client_for_portal_session($1)`,
      [sessionHash],
    )
  )[0];
  if (!row) return null;
  return {
    actor: {
      type: "user",
      id: row.profile_id,
      scope: "client",
      clientId: row.client_id,
      contactRole: row.contact_role,
      workspaceId: row.workspace_id,
      name: row.contact_name,
    },
    clientSlug: row.client_slug,
    clientName: row.client_name,
    contactName: row.contact_name,
    consentAt: row.consent_at ? new Date(row.consent_at).toISOString() : null,
    sessionHash,
  };
}

/** A sessão do portal deste pedido, pelo cookie. */
export async function currentPortalSession(): Promise<PortalSession | null> {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  return portalSessionFromToken(await getDb(), token, apiKeyPepper());
}

/** Consentimento LGPD no primeiro acesso: registra a data (uma vez). */
export async function recordPortalConsent(
  db: Db,
  sessionHash: string,
): Promise<boolean> {
  const rows = await bare<{ ok: boolean }>(
    db,
    `select proj_hub_gestao.record_client_consent($1) as ok`,
    [sessionHash],
  );
  return rows[0]?.ok === true;
}

/** Sair: encerra a sessão no banco (o cookie é apagado por quem chama). */
export async function endPortalSession(
  db: Db,
  sessionHash: string,
): Promise<void> {
  await bare(db, `select proj_hub_gestao.end_client_session($1)`, [
    sessionHash,
  ]);
}

/** Opções do cookie da sessão: só o portal, sem JavaScript, por poucas horas. */
export function portalCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/portal",
    maxAge: maxAgeSeconds,
  };
}
