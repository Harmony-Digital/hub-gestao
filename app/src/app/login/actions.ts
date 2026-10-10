"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { appUrl, magicLinkEnabled } from "@/lib/auth/config";
import {
  clientKeyFrom,
  LOGIN_MESSAGES,
  passwordLogin,
  requestMagicLink,
  type LoginDeps,
  type LoginState,
} from "@/lib/auth/login";
import { safeNextPath } from "@/lib/auth/next-path";
import { supabaseForRequest } from "@/lib/auth/supabase";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";

async function deps(): Promise<LoginDeps | null> {
  const supabase = await supabaseForRequest();
  if (!supabase) return null;
  return {
    supabase,
    db: getDb,
    workspaceSlug: serverEnv().workspaceSlug,
    clientKey: clientKeyFrom(await headers()),
  };
}

const notConfigured: LoginState = {
  status: "error",
  message: LOGIN_MESSAGES.unavailable,
};

export async function entrarComSenha(
  _previous: LoginState,
  form: FormData,
): Promise<LoginState> {
  const d = await deps();
  if (!d) return notConfigured;
  const result = await passwordLogin(d, form);
  if (result.status === "ok") redirect(result.next);
  return result;
}

export async function enviarLinkDeAcesso(
  _previous: LoginState,
  form: FormData,
): Promise<LoginState> {
  const d = await deps();
  if (!d) return notConfigured;
  return requestMagicLink(
    { ...d, enabled: magicLinkEnabled(), appUrl: appUrl() },
    form,
  );
}

export async function sair(): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    const { DEV_LOGIN_COOKIE } = await import("@/lib/auth/dev-login");
    (await cookies()).delete(DEV_LOGIN_COOKIE);
  }
  const supabase = await supabaseForRequest();
  await supabase?.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/login");
}

/**
 * Login de teste no computador de quem programa (src/lib/auth/dev-login.ts). Em
 * produção esta ação só devolve ao login: o ramo de teste some do build.
 */
export async function entrarLocal(form: FormData): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    const { DEV_LOGIN_COOKIE, devLoginCookieValue } =
      await import("@/lib/auth/dev-login");
    const value = devLoginCookieValue();
    if (value) {
      (await cookies()).set(DEV_LOGIN_COOKIE, value, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: false,
        maxAge: 12 * 60 * 60,
      });
      redirect(safeNextPath(form.get("next")));
    }
  }
  redirect("/login");
}
