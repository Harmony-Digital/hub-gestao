import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type CookieWrite = { name: string; value: string; options: object };
const gotrue = vi.hoisted(() => ({
  user: null as { id: string } | null,
  refresh: [] as CookieWrite[],
  calls: 0,
}));

// GoTrue de mentira: confere a sessão e, se pedido, "renova" os cookies.
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (c: CookieWrite[], h: Record<string, string>) => void;
      };
    },
  ) => ({
    auth: {
      getUser: async () => {
        gotrue.calls++;
        if (gotrue.refresh.length) {
          options.cookies.setAll(gotrue.refresh, {
            "Cache-Control":
              "private, no-cache, no-store, must-revalidate, max-age=0",
          });
        }
        return gotrue.user
          ? { data: { user: gotrue.user }, error: null }
          : {
              data: { user: null },
              error: { status: 401, message: "invalid" },
            };
      },
    },
  }),
}));

import { config, proxy } from "./proxy";

const SESSION = "sb-supabase-auth-token=base64-sessao";

function visit(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3100${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

beforeEach(() => {
  vi.stubEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    "https://supabase.harmonydigital.com.br",
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "chave-publica-de-teste");
  gotrue.user = null;
  gotrue.refresh = [];
  gotrue.calls = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("porta das telas (proxy)", () => {
  it("sem sessão, manda para o login guardando o destino, sem chamar o GoTrue", async () => {
    const res = await proxy(visit("/projetos?aba=plano"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3100/login?next=%2Fprojetos%3Faba%3Dplano",
    );
    expect(gotrue.calls).toBe(0);
  });

  it("a página inicial sem sessão vai para o login sem destino", async () => {
    const res = await proxy(visit("/"));
    expect(res.headers.get("location")).toBe("http://localhost:3100/login");
  });

  it("deixa abrir o login e a volta do link sem sessão", async () => {
    for (const path of [
      "/login",
      "/login?erro=sem-acesso",
      "/auth/confirmar?code=x",
    ]) {
      const res = await proxy(visit(path));
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("sessão válida segue para a tela", async () => {
    gotrue.user = { id: "u1" };
    const res = await proxy(visit("/", SESSION));
    expect(res.headers.get("location")).toBeNull();
    expect(gotrue.calls).toBe(1);
  });

  it("sessão vencida ou revogada volta para o login", async () => {
    const res = await proxy(visit("/projetos", SESSION));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3100/login?next=%2Fprojetos",
    );
  });

  it("token renovado volta nos cookies, protegidos e sem cache", async () => {
    gotrue.user = { id: "u1" };
    gotrue.refresh = [
      {
        name: "sb-supabase-auth-token",
        value: "base64-nova",
        options: { httpOnly: true, sameSite: "lax", path: "/", secure: true },
      },
    ];
    const res = await proxy(visit("/", SESSION));
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("sb-supabase-auth-token=base64-nova");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("envio de formulário sem sessão vira visita ao login (303), sem reenviar", async () => {
    const res = await proxy(
      new NextRequest("http://localhost:3100/projetos", { method: "POST" }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3100/login");
  });

  it("login de teste local abre as telas fora da produção, e só com o cookie certo", async () => {
    vi.stubEnv("HUB_DEV_LOGIN", "on");
    vi.stubEnv(
      "HUB_DEV_LOGIN_SECRET",
      "segredo-local-de-teste-com-mais-de-32-caracteres",
    );
    const { devLoginCookieValue } = await import("@/lib/auth/dev-login");
    const value = devLoginCookieValue();
    const ok = await proxy(visit("/projetos", `hub_dev_login=${value}`));
    expect(ok.headers.get("location")).toBeNull();
    expect(gotrue.calls).toBe(0);
    const falso = await proxy(visit("/projetos", "hub_dev_login=falso"));
    expect(falso.status).toBe(307);
  });

  it("em produção o cookie do login de teste não abre nada", async () => {
    vi.stubEnv("HUB_DEV_LOGIN", "on");
    vi.stubEnv(
      "HUB_DEV_LOGIN_SECRET",
      "segredo-local-de-teste-com-mais-de-32-caracteres",
    );
    const { devLoginCookieValue } = await import("@/lib/auth/dev-login");
    const value = devLoginCookieValue();
    vi.stubEnv("NODE_ENV", "production");
    const res = await proxy(visit("/projetos", `hub_dev_login=${value}`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3100/login?next=%2Fprojetos",
    );
  });

  it("sem configuração do login, toda tela fica fechada (fail-closed)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const res = await proxy(visit("/", SESSION));
    expect(res.headers.get("location")).toBe("http://localhost:3100/login");
    expect(gotrue.calls).toBe(0);
  });
});

describe("onde a porta não roda", () => {
  // O Next compila o matcher com path-to-regexp; aqui, o mesmo padrão como RegExp.
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it.each([
    "/api/health",
    "/api/v1/tasks",
    "/api/internal/cron/tick",
    "/mcp",
    "/_next/static/chunks/app.js",
    "/_next/image",
    "/favicon.ico",
    "/brand/harmony-logo-branco.png",
    "/cli/hub.mjs",
  ])("fica fora: %s (API e MCP exigem chave de agente)", (path) => {
    expect(matcher.test(path)).toBe(false);
  });

  it.each(["/", "/login", "/auth/confirmar", "/projetos/HUB", "/clientes"])(
    "passa pela porta: %s",
    (path) => {
      expect(matcher.test(path)).toBe(true);
    },
  );
});
