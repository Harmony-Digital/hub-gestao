import "server-only";
import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { HubUser } from "@/lib/auth/resolve";
import { getDb } from "@/lib/db";
import { screenMessage, toHubError } from "@/lib/errors";
import { log } from "@/lib/log";
import { inTx, type Ctx } from "@/modules/context";
import { shellData, type ShellData } from "@/modules/shell/service";

/**
 * Contexto das telas internas: quem está logado e o contexto para o núcleo (RLS,
 * autorização e histórico com source = ui). Sem sessão, getCurrentUser manda ao login.
 */
export async function pageContext(): Promise<{ user: HubUser; ctx: Ctx }> {
  // Sessão, banco, datas relativas e identificadores são da hora do pedido, nunca do
  // build: a marcação vem antes de tudo, inclusive da conferência de quem está logado.
  await connection();
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

/**
 * Contexto de uma ação de formulário (server action). Fica fora do try de quem chama:
 * sem sessão, getCurrentUser manda para o login (redirect), e isso não pode ser engolido
 * como erro comum.
 */
export async function actionContext(): Promise<Ctx> {
  const user = await getCurrentUser();
  return {
    db: await getDb(),
    actor: user.actor,
    source: "ui",
    requestId: randomUUID(),
  };
}

/** Mensagem de erro para a tela. Falha interna vai para o log, sem dados do formulário. */
export function actionErrorMessage(
  err: unknown,
  requestId: string,
  where: string,
): string {
  const hubError = toHubError(err);
  if (hubError.status >= 500) {
    log.error({ err, request_id: requestId }, where);
  }
  return screenMessage(hubError);
}
