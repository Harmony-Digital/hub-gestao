import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig, SESSION_COOKIE_OPTIONS } from "@/lib/auth/config";
import { loginPath } from "@/lib/auth/next-path";

/**
 * Porta das telas do Hub. Renova a sessão do Supabase Auth a cada visita e manda para o
 * login quem não tem sessão válida. API e MCP ficam fora (exigem chave de agente), e
 * também a CLI hub em /cli/hub.mjs (arquivo público, sem segredo, para as Actions) e o
 * portal do cliente (/portal), que tem a sessão própria (src/lib/portal/session.ts).
 * É só a primeira barreira: cada tela confere o acesso de novo (src/lib/auth/current-user.ts).
 */
const PUBLIC_PAGES = /^\/(?:login|auth)(?:\/|$)/;
const SESSION_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PAGES.test(pathname);
  // Envio de formulário (POST) sem sessão vira visita (303) ao login, sem reenviar nada.
  const readOnly = request.method === "GET" || request.method === "HEAD";
  const toLogin = () =>
    NextResponse.redirect(
      new URL(loginPath(readOnly ? pathname + search : "/"), request.url),
      readOnly ? 307 : 303,
    );

  // Login de teste local (src/lib/auth/dev-login.ts): só fora da produção. O teste de
  // NODE_ENV fica escrito aqui para o build de produção remover o ramo inteiro.
  if (process.env.NODE_ENV !== "production") {
    const { DEV_LOGIN_COOKIE, isValidDevLogin } =
      await import("@/lib/auth/dev-login");
    if (isValidDevLogin(request.cookies.get(DEV_LOGIN_COOKIE)?.value)) {
      return NextResponse.next();
    }
  }

  const config = authConfig();
  if (!config) return isPublic ? NextResponse.next() : toLogin();

  const hasSession = request.cookies
    .getAll()
    .some((c) => SESSION_COOKIE.test(c.name));
  if (!hasSession) return isPublic ? NextResponse.next() : toLogin();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, cacheHeaders) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(cacheHeaders)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Confere a sessão no GoTrue e, se o token venceu, renova e regrava os cookies.
  const { data, error } = await supabase.auth.getUser();
  if ((error || !data.user) && !isPublic) {
    const redirect = toLogin();
    for (const cookie of response.cookies.getAll())
      redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api|mcp|portal|_next/static|_next/image|favicon.ico|brand/|cli/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml)$).*)",
  ],
};
