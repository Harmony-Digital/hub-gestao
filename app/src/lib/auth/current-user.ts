import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { loginPath } from "./next-path";
import { resolveHubUser, type HubUser } from "./resolve";
import { verifiedAuthUser } from "./supabase";

/**
 * Quem está usando a interface. Toda tela e toda ação da interface passa por aqui: o
 * proxy só barra visitas sem sessão, e quem decide o acesso é esta conferência, perto dos
 * dados (sessão válida no GoTrue + perfil e vínculo ativos no Hub). Uma vez por pedido.
 */
export const getCurrentUser = cache(async (): Promise<HubUser> => {
  const identity = await verifiedAuthUser();
  if (!identity) redirect(loginPath());
  let user: HubUser | null;
  try {
    user = await resolveHubUser(
      await getDb(),
      identity,
      serverEnv().workspaceSlug,
    );
  } catch (err) {
    log.error({ err }, "Falha ao conferir o acesso de quem entrou no Hub.");
    redirect(loginPath(undefined, "indisponivel"));
  }
  if (!user) redirect(loginPath(undefined, "sem-acesso"));
  return user;
});
