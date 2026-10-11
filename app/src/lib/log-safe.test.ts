import { describe, expect, it } from "vitest";
import { safeError, scrub } from "./log-safe";

describe("erro no log, sem dado pessoal nem segredo", () => {
  it("o detail do Postgres, com o valor repetido, não vai para o log", () => {
    const err = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "profiles_email_key"',
      ),
      {
        code: "23505",
        detail: "Key (email)=(maria.silva@exemplo.com) already exists.",
        where: "SQL statement ...",
        table: "profiles",
      },
    );
    const out = safeError(err);
    expect(out).toMatchObject({
      type: "Error",
      code: "23505",
      message:
        'duplicate key value violates unique constraint "profiles_email_key"',
    });
    expect(JSON.stringify(out)).not.toMatch(/maria|exemplo\.com|detail|where/);
  });

  it("troca e-mail, chave, token e senha de endereço de banco por marcadores", () => {
    expect(
      scrub(
        "falhou para ana@cliente.com.br com hub_ak_abc123_def e Bearer sk-1234567890abcdef",
      ),
    ).toBe("falhou para [e-mail] com [chave] e Bearer [removido]");
    expect(
      scrub("postgres://hub_gestao_app:senha-forte@db:5432/postgres"),
    ).toBe("postgres://[removido]@db:5432/postgres");
    expect(scrub("token eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl")).toBe(
      "token [token]",
    );
    expect(scrub("segredo whsec_abcDEF123")).toBe("segredo [segredo]");
  });

  it("guarda o status do erro do Hub e corta a mensagem longa", () => {
    const err = Object.assign(new Error("x".repeat(500)), { status: 503 });
    const out = safeError(err);
    expect(out.status).toBe(503);
    expect(String(out.message)).toHaveLength(300);
    expect(safeError("texto solto de ana@x.com")).toEqual({
      message: "texto solto de [e-mail]",
    });
  });
});
