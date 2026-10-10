// Sem "server-only": o proxy (src/proxy.ts) também usa este módulo. Ele já não roda no
// navegador, porque depende de node:crypto e do segredo do .env.local.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { VerifiedAuthUser } from "./supabase";

/**
 * Login de desenvolvimento: só no computador de quem programa, para ver as telas com o
 * banco local (PGlite) sem usar o Supabase Auth compartilhado.
 *
 * Travas:
 *  - nunca em produção: o build troca process.env.NODE_ENV por "production", e as
 *    chamadas (sempre atrás desse teste) somem do pacote; o CI confere a recusa;
 *  - liga só com HUB_DEV_LOGIN=on e HUB_DEV_LOGIN_SECRET de 32+ caracteres no .env.local;
 *  - o cookie é uma assinatura HMAC desse segredo, conferida em tempo constante.
 */
export const DEV_LOGIN_COOKIE = "hub_dev_login";

/** Identidade usada no banco local: o dono do seed (Fábio). Nunca existe em produção. */
export const DEV_IDENTITY: VerifiedAuthUser = {
  id: "00000000-0000-4000-8000-0000000d0001",
  email: "contato@harmonydigital.com.br",
  emailConfirmed: true,
};

function secret(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const value = process.env.HUB_DEV_LOGIN_SECRET ?? "";
  return process.env.HUB_DEV_LOGIN === "on" && value.length >= 32
    ? value
    : null;
}

export function devLoginEnabled(): boolean {
  return secret() !== null;
}

function signature(key: string): string {
  return createHmac("sha256", key)
    .update("hub-dev-login:v1")
    .digest("base64url");
}

/** Valor do cookie de desenvolvimento; null quando o login de teste está desligado. */
export function devLoginCookieValue(): string | null {
  const key = secret();
  return key ? signature(key) : null;
}

export function isValidDevLogin(value: string | undefined | null): boolean {
  const key = secret();
  if (!key || !value) return false;
  const expected = Buffer.from(signature(key));
  const given = Buffer.from(value);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
