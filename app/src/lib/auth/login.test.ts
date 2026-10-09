import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applySeed, openLocalDatabase } from "@/lib/db/local";
import type { Db } from "@/lib/db/types";
import {
  clientKeyFrom,
  confirmEmailLink,
  createLoginLimits,
  LOGIN_MESSAGES,
  passwordLogin,
  requestMagicLink,
  type LoginDeps,
} from "./login";

const S = "proj_hub_gestao";
const OWNER_EMAIL = "contato@harmonydigital.com.br";
let db: Db;
let raw: PGlite;

type AuthError = { status?: number; code?: string; message: string };
type FakeUser = {
  id: string;
  email: string;
  email_confirmed_at: string | null;
};

/** GoTrue de mentira: só o que a tela de login usa. */
function fakeAuth(
  opts: {
    signIn?: { user?: FakeUser; error?: AuthError };
    otpError?: AuthError;
    exchange?: { user?: FakeUser; error?: AuthError };
    verify?: { user?: FakeUser; error?: AuthError };
  } = {},
) {
  const result = (r?: { user?: FakeUser; error?: AuthError }) => ({
    data: { user: r?.user ?? null, session: null },
    error: r?.error ?? null,
  });
  return {
    signInWithPassword: vi.fn(async () => result(opts.signIn)),
    signInWithOtp: vi.fn(async () => ({
      data: {},
      error: opts.otpError ?? null,
    })),
    exchangeCodeForSession: vi.fn(async () => result(opts.exchange)),
    verifyOtp: vi.fn(async () => result(opts.verify)),
    signOut: vi.fn(async () => ({ error: null })),
  };
}

function deps(
  auth: ReturnType<typeof fakeAuth>,
  over: Partial<LoginDeps> = {},
): LoginDeps {
  return {
    supabase: { auth } as unknown as LoginDeps["supabase"],
    db: async () => db,
    workspaceSlug: "harmony",
    clientKey: "203.0.113.10",
    limits: createLoginLimits(),
    ...over,
  };
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const fabio = (): FakeUser => ({
  id: randomUUID(),
  email: OWNER_EMAIL,
  email_confirmed_at: "2026-10-09T12:00:00Z",
});

beforeAll(async () => {
  ({ db, raw } = await openLocalDatabase());
  await applySeed(raw);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await raw.exec(`update ${S}.profiles set auth_user_id = null`);
});

describe("login por e-mail e senha", () => {
  it("entra e volta para a página pedida", async () => {
    const auth = fakeAuth({ signIn: { user: fabio() } });
    const result = await passwordLogin(
      deps(auth),
      form({
        email: " Contato@HarmonyDigital.com.br ",
        password: "senha",
        next: "/projetos?aba=hoje",
      }),
    );
    expect(result).toEqual({ status: "ok", next: "/projetos?aba=hoje" });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: OWNER_EMAIL,
      password: "senha",
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("não segue endereço externo depois do login", async () => {
    const auth = fakeAuth({ signIn: { user: fabio() } });
    const result = await passwordLogin(
      deps(auth),
      form({
        email: OWNER_EMAIL,
        password: "senha",
        next: "//evil.example/x",
      }),
    );
    expect(result).toEqual({ status: "ok", next: "/" });
  });

  it("senha errada recebe a mesma mensagem de e-mail inexistente", async () => {
    const auth = fakeAuth({
      signIn: {
        error: {
          status: 400,
          code: "invalid_credentials",
          message: "Invalid login credentials",
        },
      },
    });
    const result = await passwordLogin(
      deps(auth),
      form({ email: OWNER_EMAIL, password: "errada" }),
    );
    expect(result).toEqual({
      status: "error",
      message: LOGIN_MESSAGES.invalid,
      email: OWNER_EMAIL,
    });
  });

  it("campos vazios e e-mail inválido não chegam ao GoTrue", async () => {
    const auth = fakeAuth();
    expect(
      await passwordLogin(deps(auth), form({ email: "", password: "" })),
    ).toMatchObject({ status: "error", message: LOGIN_MESSAGES.incomplete });
    expect(
      await passwordLogin(
        deps(auth),
        form({ email: "sem-arroba", password: "x" }),
      ),
    ).toMatchObject({ status: "error", message: LOGIN_MESSAGES.invalid });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("GoTrue fora do ar ou limitando vira mensagem clara", async () => {
    const down = fakeAuth({ signIn: { error: { message: "fetch failed" } } });
    expect(
      await passwordLogin(
        deps(down),
        form({ email: OWNER_EMAIL, password: "x" }),
      ),
    ).toMatchObject({ message: LOGIN_MESSAGES.unavailable });
    const limited = fakeAuth({
      signIn: { error: { status: 429, message: "rate limit" } },
    });
    expect(
      await passwordLogin(
        deps(limited),
        form({ email: OWNER_EMAIL, password: "x" }),
      ),
    ).toMatchObject({ message: LOGIN_MESSAGES.tooMany });
  });

  it("login válido sem acesso ao Hub é encerrado na hora", async () => {
    const auth = fakeAuth({
      signIn: {
        user: {
          id: randomUUID(),
          email: "alguem@exemplo.com",
          email_confirmed_at: "2026-10-09T12:00:00Z",
        },
      },
    });
    const result = await passwordLogin(
      deps(auth),
      form({ email: "alguem@exemplo.com", password: "x" }),
    );
    expect(result).toMatchObject({
      status: "error",
      message: LOGIN_MESSAGES.noAccess,
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("banco indisponível encerra a sessão e não deixa entrar", async () => {
    const auth = fakeAuth({ signIn: { user: fabio() } });
    const result = await passwordLogin(
      deps(auth, {
        db: async () => {
          throw new Error("sem banco");
        },
      }),
      form({ email: OWNER_EMAIL, password: "x" }),
    );
    expect(result).toMatchObject({
      status: "error",
      message: LOGIN_MESSAGES.hubUnavailable,
    });
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("limita tentativas seguidas para o mesmo e-mail", async () => {
    const auth = fakeAuth({
      signIn: { error: { status: 400, message: "Invalid login credentials" } },
    });
    const d = deps(auth);
    for (let i = 0; i < 8; i++) {
      await passwordLogin(d, form({ email: OWNER_EMAIL, password: "x" }));
    }
    const blocked = await passwordLogin(
      d,
      form({ email: OWNER_EMAIL, password: "x" }),
    );
    expect(blocked).toMatchObject({ message: LOGIN_MESSAGES.tooMany });
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(8);
  });
});

describe("link de acesso por e-mail", () => {
  const enabled = {
    enabled: true,
    appUrl: "https://hub.harmonydigital.com.br",
  };

  it("fica desligado até a configuração ser autorizada", async () => {
    const auth = fakeAuth();
    const result = await requestMagicLink(
      { ...deps(auth), enabled: false, appUrl: null },
      form({ email: OWNER_EMAIL }),
    );
    expect(result).toMatchObject({ message: LOGIN_MESSAGES.magicLinkOff });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("pede o link sem criar usuário e com retorno para o Hub", async () => {
    const auth = fakeAuth();
    const result = await requestMagicLink(
      { ...deps(auth), ...enabled },
      form({ email: OWNER_EMAIL, next: "/projetos" }),
    );
    expect(result).toEqual({
      status: "sent",
      message: LOGIN_MESSAGES.magicLinkSent,
    });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: OWNER_EMAIL,
      options: {
        shouldCreateUser: false,
        emailRedirectTo:
          "https://hub.harmonydigital.com.br/auth/confirmar?next=%2Fprojetos",
      },
    });
  });

  it("e-mail sem cadastro recebe a mesma resposta", async () => {
    const auth = fakeAuth({
      otpError: {
        status: 422,
        code: "otp_disabled",
        message: "Signups not allowed",
      },
    });
    const result = await requestMagicLink(
      { ...deps(auth), ...enabled },
      form({ email: "alguem@exemplo.com" }),
    );
    expect(result).toMatchObject({ status: "sent" });
  });

  it("no máximo 3 pedidos por e-mail a cada 15 minutos", async () => {
    const auth = fakeAuth();
    const d = { ...deps(auth), ...enabled };
    for (let i = 0; i < 3; i++) {
      await requestMagicLink(d, form({ email: OWNER_EMAIL }));
    }
    expect(
      await requestMagicLink(d, form({ email: OWNER_EMAIL })),
    ).toMatchObject({ message: LOGIN_MESSAGES.tooMany });
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(3);
  });
});

describe("volta do link de acesso", () => {
  it("troca o código por sessão e segue para a página pedida", async () => {
    const auth = fakeAuth({ exchange: { user: fabio() } });
    const result = await confirmEmailLink(
      deps(auth),
      new URLSearchParams({ code: "codigo-pkce", next: "/projetos" }),
    );
    expect(result).toEqual({ redirectTo: "/projetos" });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("codigo-pkce");
  });

  it("aceita o token do e-mail e recusa tipos que não são de login", async () => {
    const ok = fakeAuth({ verify: { user: fabio() } });
    expect(
      await confirmEmailLink(
        deps(ok),
        new URLSearchParams({ token_hash: "abc", type: "magiclink" }),
      ),
    ).toEqual({ redirectTo: "/" });

    const recovery = fakeAuth({ verify: { user: fabio() } });
    expect(
      await confirmEmailLink(
        deps(recovery),
        new URLSearchParams({ token_hash: "abc", type: "recovery" }),
      ),
    ).toEqual({ redirectTo: "/login?erro=link-invalido" });
    expect(recovery.verifyOtp).not.toHaveBeenCalled();
  });

  it("link vencido volta para o login com o aviso certo", async () => {
    const auth = fakeAuth({
      exchange: { error: { status: 400, message: "invalid flow state" } },
    });
    expect(
      await confirmEmailLink(
        deps(auth),
        new URLSearchParams({ code: "velho", next: "/projetos" }),
      ),
    ).toEqual({ redirectTo: "/login?erro=link-invalido&next=%2Fprojetos" });
  });

  it("login sem acesso ao Hub é encerrado", async () => {
    const auth = fakeAuth({
      exchange: {
        user: {
          id: randomUUID(),
          email: "alguem@exemplo.com",
          email_confirmed_at: "2026-10-09T12:00:00Z",
        },
      },
    });
    expect(
      await confirmEmailLink(deps(auth), new URLSearchParams({ code: "c" })),
    ).toEqual({ redirectTo: "/login?erro=sem-acesso" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("origem do pedido para o limite de tentativas", () => {
  it("usa o primeiro IP repassado pelo Traefik", () => {
    expect(
      clientKeyFrom(
        new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.2" }),
      ),
    ).toBe("198.51.100.7");
    expect(clientKeyFrom(new Headers({ "x-real-ip": "198.51.100.8" }))).toBe(
      "198.51.100.8",
    );
    expect(clientKeyFrom(new Headers())).toBe("local");
  });
});
