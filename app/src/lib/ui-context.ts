import "server-only";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { HubUser } from "@/lib/auth/resolve";
import { getDb } from "@/lib/db";
import { inTx, type Ctx } from "@/modules/context";
import { shellData, type ShellData } from "@/modules/shell/service";

/**
 * Contexto das telas internas: quem está logado e o contexto para o núcleo (RLS,
 * autorização e histórico com source = ui). Sem sessão, getCurrentUser manda ao login.
 */
export async function pageContext(): Promise<{ user: HubUser; ctx: Ctx }> {
  const user = await getCurrentUser();
  return {
    user,
    ctx: {
      db: await getDb(),
      actor: user.actor,
      source: "ui",
      requestId: randomUUID(),
    },
  };
}

/** Dados da barra lateral, uma vez por pedido (o menu do celular repete a barra). */
export const getShell = cache(
  async (): Promise<{ user: HubUser; data: ShellData }> => {
    const { user, ctx } = await pageContext();
    return { user, data: await inTx(ctx, (t) => shellData(t)) };
  },
);
