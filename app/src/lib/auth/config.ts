/**
 * Configuração do login (Supabase Auth compartilhado da Harmony).
 *
 * O endereço e a chave pública (publishable) entram no build da imagem, como toda
 * variável NEXT_PUBLIC_. Não são segredo: só identificam o Supabase. Sem eles, o login
 * fica fechado e toda tela pede para entrar (fail-closed).
 */
export type AuthConfig = { url: string; publishableKey: string };

export function authConfig(): AuthConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !local) return null;
  } catch {
    return null;
  }
  return { url, publishableKey };
}

/**
 * Link de acesso por e-mail. Desligado até o Fábio autorizar, no Supabase compartilhado,
 * o envio de e-mails e o endereço de retorno do Hub (lista de redirecionamento do GoTrue).
 */
export function magicLinkEnabled(): boolean {
  return process.env.HUB_AUTH_MAGIC_LINK === "on" && appUrl() !== null;
}

/** Endereço público do Hub, usado no retorno do link de acesso. */
export function appUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Cookie da sessão: invisível para scripts da página e só por HTTPS em produção. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: process.env.NODE_ENV === "production",
} as const;
