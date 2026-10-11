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

export type PortalCommentResult =
  | {
      status: "ok";
      commentId: string;
      projectId: string;
      workspaceId: string;
    }
  | { status: "no_session" | "not_found" | "invalid" | "too_many" };

/**
 * O contato escreve no canal do projeto. Quem é o contato, se o projeto é dele, o tamanho
 * do texto e o limite de mensagens por hora são conferidos no banco, a partir da sessão
 * (função post_client_comment, migração 0017).
 */
export async function postPortalComment(
  db: Db,
  sessionHash: string,
  projectCode: string,
  body: string,
): Promise<PortalCommentResult> {
  const rows = await bare<{ result: Record<string, string> }>(
    db,
    `select proj_hub_gestao.post_client_comment($1, $2, $3) as result`,
    [sessionHash, projectCode, body],
  );
  const r = rows[0]?.result;
  if (r?.status === "ok") {
    return {
      status: "ok",
      commentId: r.comment_id,
      projectId: r.project_id,
      workspaceId: r.workspace_id,
    };
  }
  const status = r?.status;
  return {
    status:
      status === "not_found" || status === "invalid" || status === "too_many"
        ? status
        : "no_session",
  };
}

export type PortalReceiptResult =
  | {
      status: "ok";
      milestoneId: string;
      projectId: string;
      workspaceId: string;
    }
  | { status: "no_session" | "not_allowed" | "not_found" | "already" };

/**
 * O contato decisor confirma que recebeu uma entrega (opção do projeto, D9; não é o
 * aceite). Tudo é conferido no banco, a partir da sessão (função
 * confirm_milestone_receipt, migração 0018).
 */
export async function confirmPortalReceipt(
  db: Db,
  sessionHash: string,
  projectCode: string,
  milestoneId: string,
): Promise<PortalReceiptResult> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      milestoneId,
    )
  ) {
    return { status: "not_found" };
  }
  const rows = await bare<{ result: Record<string, string> }>(
    db,
    `select proj_hub_gestao.confirm_milestone_receipt($1, $2, $3::uuid) as result`,
    [sessionHash, projectCode, milestoneId],
  );
  const r = rows[0]?.result;
  if (r?.status === "ok") {
    return {
      status: "ok",
      milestoneId: r.milestone_id,
      projectId: r.project_id,
      workspaceId: r.workspace_id,
    };
  }
  const status = r?.status;
  return {
    status:
      status === "not_allowed" || status === "not_found" || status === "already"
        ? status
        : "no_session",
  };
}

/** Por quanto tempo vale o link que o contato pede pelo e-mail (RF-05). */
export const REQUESTED_LINK_MINUTES = 30;

/** Um link pedido pelo contato, pronto para ir ao e-mail cadastrado dele. */
export type RequestedPortalLink = {
  email: string;
  contactName: string;
  clientName: string;
  orgName: string;
  url: string;
};

/**
 * O contato pede um link novo pelo e-mail (RF-05). Quem pode receber, os limites e o
 * registro ficam no banco (função request_client_login_link, migração 0025): só contato
 * que o dono já liberou, de cliente com o portal ligado. Um link por cliente, quando a
 * mesma pessoa é contato de mais de um. Lista vazia não diz por quê (e-mail que não
 * existe, sem acesso ou limite): quem pede sempre vê a mesma resposta.
 */
export async function requestPortalLinks(
  db: Db,
  email: string,
  options: { pepper: string; appUrl: string },
): Promise<RequestedPortalLink[]> {
  const tokens = Array.from({ length: 5 }, () => generatePortalToken());
  const rows = await bare<{
    link_index: number;
    contact_email: string;
    contact_name: string;
    client_name: string;
    workspace_name: string;
  }>(
    db,
    `select * from proj_hub_gestao.request_client_login_link($1, $2::text[], $3)`,
    [
      email,
      tokens.map((t) => hashPortalToken(t, options.pepper)),
      REQUESTED_LINK_MINUTES,
    ],
  );
  const base = options.appUrl.replace(/\/+$/, "");
  return rows.map((r) => ({
    email: r.contact_email,
    contactName: r.contact_name,
    clientName: r.client_name,
    orgName: r.workspace_name,
    url: `${base}/portal/entrar/${tokens[r.link_index - 1]}`,
  }));
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
