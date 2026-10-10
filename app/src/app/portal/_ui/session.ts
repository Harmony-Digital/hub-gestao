import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { currentPortalSession, type PortalSession } from "@/lib/portal/session";
import type { Ctx } from "@/modules/context";

/**
 * A sessão do portal deste pedido, se for do cliente do endereço. Sem sessão, ou sessão
 * de outro cliente: null, e a tela responde igual nos dois casos, sem revelar nada.
 */
export async function portalSessionFor(
  cliente: string,
): Promise<PortalSession | null> {
  const session = await currentPortalSession();
  return session && session.clientSlug === cliente ? session : null;
}

/** Contexto das leituras do portal: o ator de cliente, sob a RLS do cliente. */
export async function portalContext(session: PortalSession): Promise<Ctx> {
  return {
    db: await getDb(),
    actor: session.actor,
    source: "ui",
    requestId: randomUUID(),
  };
}
