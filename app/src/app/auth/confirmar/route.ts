import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection, type NextRequest } from "next/server";
import { clientKeyFrom, confirmEmailLink } from "@/lib/auth/login";
import { loginPath } from "@/lib/auth/next-path";
import { supabaseForRequest } from "@/lib/auth/supabase";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";

/** Volta do link de acesso enviado por e-mail (Supabase Auth). */
export async function GET(request: NextRequest): Promise<never> {
  // Sempre na hora do pedido: sem isto, um build sem a configuração do login gravaria
  // o redirecionamento de "indisponível" como resposta fixa.
  await connection();
  const supabase = await supabaseForRequest();
  if (!supabase) redirect(loginPath(undefined, "indisponivel"));
  const { redirectTo } = await confirmEmailLink(
    {
      supabase,
      db: getDb,
      workspaceSlug: serverEnv().workspaceSlug,
      clientKey: clientKeyFrom(await headers()),
    },
    request.nextUrl.searchParams,
  );
  redirect(redirectTo);
}
