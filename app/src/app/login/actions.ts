"use server";

import { headers } from "next/headers";
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
  const supabase = await supabaseForRequest();
  await supabase?.auth.signOut({ scope: "local" }).catch(() => undefined);
  redirect("/login");
}
