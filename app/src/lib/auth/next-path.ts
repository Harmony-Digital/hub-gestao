const BASE = "http://hub.invalid";
const AUTH_PAGES = /^\/(?:login|auth)(?:\/|$)/;

/**
 * Para onde voltar depois do login. Só aceita caminho interno do próprio Hub: nada de
 * outro domínio, "//", barra invertida ou caracteres de controle. Qualquer dúvida vira "/".
 */
export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) {
    return "/";
  }
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return "/";
  }
  if (/[\u0000-\u001F\u007F]/.test(raw)) return "/";
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE) return "/";
  const path = `${url.pathname}${url.search}`;
  return AUTH_PAGES.test(url.pathname) ? "/" : path;
}

/** Endereço da tela de login guardando para onde a pessoa queria ir. */
export function loginPath(next?: string, error?: LoginErrorCode): string {
  const params = new URLSearchParams();
  const target = next ? safeNextPath(next) : "/";
  if (target !== "/") params.set("next", target);
  if (error) params.set("erro", error);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

export type LoginErrorCode = "sem-acesso" | "link-invalido" | "indisponivel";

const LOGIN_ERRORS: Record<LoginErrorCode, string> = {
  "sem-acesso":
    "Este login ainda não tem acesso ao Hub. Peça a liberação ao Fábio.",
  "link-invalido":
    "O link de acesso expirou ou já foi usado. Peça um novo ou entre com a senha.",
  indisponivel:
    "Não foi possível concluir o login agora. Tente de novo em alguns minutos.",
};

export function loginErrorMessage(code: unknown): string | null {
  return typeof code === "string" && code in LOGIN_ERRORS
    ? LOGIN_ERRORS[code as LoginErrorCode]
    : null;
}
