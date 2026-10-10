import { describe, expect, it } from "vitest";
import { parsePasswordForm } from "./form";

function form(password?: string, confirmation?: string): FormData {
  const f = new FormData();
  if (password !== undefined) f.set("password", password);
  if (confirmation !== undefined) f.set("confirmation", confirmation);
  return f;
}

describe("definição de senha", () => {
  it("aceita senha de 10 a 72 caracteres com a confirmação igual", () => {
    const senha = "uma frase longa e boa";
    expect(parsePasswordForm(form(senha, senha))).toEqual({
      ok: true,
      password: senha,
    });
  });

  it.each([
    ["vazia", form("", "")],
    ["sem campo", form()],
    ["curta", form("curta123", "curta123")],
    ["longa demais", form("a".repeat(73), "a".repeat(73))],
    [
      "com espaço nas pontas",
      form(" frase longa e boa ", " frase longa e boa "),
    ],
    ["confirmação diferente", form("frase longa e boa", "frase longa e boa!")],
  ])("recusa senha %s", (_label, f) => {
    expect(parsePasswordForm(f).ok).toBe(false);
  });
});
