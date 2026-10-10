import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { authConfig, SESSION_COOKIE_OPTIONS } from "./config";

/**
 * Cliente do Supabase Auth ligado aos cookies deste pedido. Um por pedido, nunca
 * compartilhado. Em componentes de servidor os cookies são só de leitura; quem renova a
 * sessão é o proxy (src/proxy.ts) e as ações de login e saída.
 */
export async function supabaseForRequest(): Promise<SupabaseClient | null> {
  // Lê os cookies antes de tudo: assim quem confere a sessão é sempre resolvido na hora
  // do pedido, nunca no build (mesmo quando o build não tem a configuração do login).
  const store = await cookies();
  const config = authConfig();
  if (!config) return null;
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) {
            store.set(name, value, options);
          }
        } catch {
          // Componente de servidor: não grava cookie. O proxy já renovou a sessão.
        }
      },
    },
  });
}

/** Usuário do Supabase Auth já conferido no próprio GoTrue (não só lido do cookie). */
export type VerifiedAuthUser = {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
};

export function toVerifiedAuthUser(
  user: Pick<User, "id" | "email" | "email_confirmed_at"> | null | undefined,
): VerifiedAuthUser | null {
  if (!user?.id) return null;
  return {
    id: user.id,
    email: user.email?.trim() || null,
    emailConfirmed: Boolean(user.email_confirmed_at),
  };
}

/** Confere a sessão do pedido no GoTrue. Sessão ausente, vencida ou revogada: null. */
export async function verifiedAuthUser(): Promise<VerifiedAuthUser | null> {
  // Login de teste local (src/lib/auth/dev-login.ts). O teste de NODE_ENV fica aqui,
  // escrito direto, para o build de produção remover este ramo inteiro.
  if (process.env.NODE_ENV !== "production") {
    const { DEV_IDENTITY, DEV_LOGIN_COOKIE, isValidDevLogin } =
      await import("./dev-login");
    const store = await cookies();
    if (isValidDevLogin(store.get(DEV_LOGIN_COOKIE)?.value)) {
      return DEV_IDENTITY;
    }
  }
  const supabase = await supabaseForRequest();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return toVerifiedAuthUser(data.user);
}
