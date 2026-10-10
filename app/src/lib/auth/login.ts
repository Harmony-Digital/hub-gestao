import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { log } from "@/lib/log";
import { RateLimiter } from "@/lib/rate-limit";
import type { LoginState } from "./login-state";
import { loginErrorMessage, safeNextPath } from "./next-path";
import { resolveHubUser, type HubUser } from "./resolve";
import { toVerifiedAuthUser } from "./supabase";

export type { LoginState };

export type LoginResult = LoginState | { status: "ok"; next: string };

type AuthClient = Pick<SupabaseClient, "auth">;

export type LoginDeps = {
  supabase: AuthClient;
  db: () => Promise<Db>;
  workspaceSlug: string;
  /** Origem do pedido (IP vindo do Traefik), para o limite de tentativas. */
  clientKey: string;
  limits?: LoginLimits;
};

/**
 * Limite de tentativas, além do que o próprio GoTrue aplica: 20 por origem e 8 por
 * e-mail a cada 15 minutos; link por e-mail, 3 por endereço. Em memória (um contêiner).
 */
export type LoginLimits = {
  perClient: RateLimiter;
  perEmail: RateLimiter;
  magicLink: RateLimiter;
};

const FIFTEEN_MINUTES = 15 * 60_000;

export function createLoginLimits(): LoginLimits {
  return {
    perClient: new RateLimiter(20, FIFTEEN_MINUTES),
    perEmail: new RateLimiter(8, FIFTEEN_MINUTES),
    magicLink: new RateLimiter(3, FIFTEEN_MINUTES),
  };
}

const defaultLimits = createLoginLimits();

const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const Password = z.string().min(1).max(256);

const MESSAGES = {
  invalid: "E-mail ou senha incorretos.",
  incomplete: "Informe o e-mail e a senha.",
  invalidEmail: "Informe um e-mail válido.",
  tooMany:
    "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
  unavailable:
    "O serviço de login não respondeu agora. Tente de novo em alguns minutos.",
  noAccess: loginErrorMessage("sem-acesso") as string,
  hubUnavailable: loginErrorMessage("indisponivel") as string,
  magicLinkOff:
    "O link de acesso por e-mail ainda não está ligado. Entre com a senha.",
  magicLinkSent:
    "Se este e-mail tiver acesso ao Hub, o link chega em instantes. Abra-o neste mesmo navegador.",
} as const;

export const LOGIN_MESSAGES = MESSAGES;

/** Primeiro IP do X-Forwarded-For (definido pelo Traefik); fora dele, "local". */
export function clientKeyFrom(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = headers.get("x-real-ip")?.trim();
  const value = forwarded || real || "local";
  return value.slice(0, 64);
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function authErrorMessage(error: { status?: number; code?: string }): string {
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return MESSAGES.tooMany;
  }
  if (!error.status || error.status >= 500) return MESSAGES.unavailable;
  return MESSAGES.invalid;
}

/**
 * Depois de o GoTrue aceitar a senha (ou o link), confere o acesso no Hub. Sem acesso,
 * a sessão recém-criada é encerrada na hora: login sem vínculo não abre nada.
 */
async function admit(
  deps: LoginDeps,
  user: Parameters<typeof toVerifiedAuthUser>[0],
): Promise<{ ok: true; user: HubUser } | { ok: false; message: string }> {
  const identity = toVerifiedAuthUser(user);
  let hubUser: HubUser | null = null;
  let failed = false;
  if (identity) {
    try {
      hubUser = await resolveHubUser(
        await deps.db(),
        identity,
        deps.workspaceSlug,
      );
    } catch (err) {
      failed = true;
      log.error({ err }, "Falha ao conferir o acesso no login.");
    }
  }
  if (!hubUser) {
    await deps.supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return {
      ok: false,
      message: failed ? MESSAGES.hubUnavailable : MESSAGES.noAccess,
    };
  }
  log.info(
    { profile_id: hubUser.actor.id, first_login: hubUser.linkedNow },
    "Login na interface do Hub.",
  );
  return { ok: true, user: hubUser };
}

export async function passwordLogin(
  deps: LoginDeps,
  form: FormData,
): Promise<LoginResult> {
  const limits = deps.limits ?? defaultLimits;
  const rawEmail = field(form, "email");
  const password = field(form, "password");
  const next = safeNextPath(field(form, "next"));
  if (!rawEmail.trim() || !password) {
    return { status: "error", message: MESSAGES.incomplete, email: rawEmail };
  }
  const email = Email.safeParse(rawEmail);
  if (!email.success || !Password.safeParse(password).success) {
    return { status: "error", message: MESSAGES.invalid, email: rawEmail };
  }
  if (
    !limits.perClient.take(deps.clientKey).ok ||
    !limits.perEmail.take(email.data).ok
  ) {
    return { status: "error", message: MESSAGES.tooMany, email: email.data };
  }

  const { data, error } = await deps.supabase.auth.signInWithPassword({
    email: email.data,
    password,
  });
  if (error || !data.user) {
    return {
      status: "error",
      message: error ? authErrorMessage(error) : MESSAGES.invalid,
      email: email.data,
    };
  }
  const admitted = await admit(deps, data.user);
  if (!admitted.ok) {
    return { status: "error", message: admitted.message, email: email.data };
  }
  return { status: "ok", next };
}

export async function requestMagicLink(
  deps: LoginDeps & { enabled: boolean; appUrl: string | null },
  form: FormData,
): Promise<LoginState> {
  const limits = deps.limits ?? defaultLimits;
  if (!deps.enabled || !deps.appUrl) {
    return { status: "error", message: MESSAGES.magicLinkOff };
  }
  const email = Email.safeParse(field(form, "email"));
  if (!email.success) {
    return {
      status: "error",
      message: MESSAGES.invalidEmail,
      email: field(form, "email"),
    };
  }
  if (
    !limits.perClient.take(deps.clientKey).ok ||
    !limits.magicLink.take(email.data).ok
  ) {
    return { status: "error", message: MESSAGES.tooMany, email: email.data };
  }
  const next = safeNextPath(field(form, "next"));
  const redirectTo = new URL("/auth/confirmar", deps.appUrl);
  if (next !== "/") redirectTo.searchParams.set("next", next);
  const { error } = await deps.supabase.auth.signInWithOtp({
    email: email.data,
    options: { shouldCreateUser: false, emailRedirectTo: redirectTo.href },
  });
  // E-mail sem cadastro também recebe a mesma resposta: a tela não revela quem existe.
  if (error && (error.status === 429 || !error.status || error.status >= 500)) {
    return {
      status: "error",
      message: authErrorMessage(error),
      email: email.data,
    };
  }
  return { status: "sent", message: MESSAGES.magicLinkSent };
}

const OTP_TYPES = new Set(["magiclink", "email"]);

/** Volta do link de acesso: troca o código (ou o token) por sessão e confere o acesso. */
export async function confirmEmailLink(
  deps: LoginDeps,
  params: URLSearchParams,
): Promise<{ redirectTo: string }> {
  const next = safeNextPath(params.get("next"));
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const failure = (erro: "link-invalido" | "sem-acesso" | "indisponivel") => {
    const query = new URLSearchParams({ erro });
    if (next !== "/") query.set("next", next);
    return { redirectTo: `/login?${query.toString()}` };
  };

  let user: Parameters<typeof toVerifiedAuthUser>[0] = null;
  if (code && code.length <= 512) {
    const { data, error } =
      await deps.supabase.auth.exchangeCodeForSession(code);
    if (!error) user = data.user;
  } else if (
    tokenHash &&
    tokenHash.length <= 512 &&
    type &&
    OTP_TYPES.has(type)
  ) {
    const { data, error } = await deps.supabase.auth.verifyOtp({
      type: type as "magiclink" | "email",
      token_hash: tokenHash,
    });
    if (!error) user = data.user;
  }
  if (!user) return failure("link-invalido");
  const admitted = await admit(deps, user);
  if (!admitted.ok) {
    return failure(
      admitted.message === MESSAGES.noAccess ? "sem-acesso" : "indisponivel",
    );
  }
  return { redirectTo: next };
}
