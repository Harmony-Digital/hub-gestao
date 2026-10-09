import { describe, expect, it } from "vitest";
import { loginErrorMessage, loginPath, safeNextPath } from "./next-path";

describe("para onde voltar depois do login", () => {
  it("aceita caminho interno, com busca", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/projetos/HUB?aba=plano")).toBe(
      "/projetos/HUB?aba=plano",
    );
  });

  it.each([
    ["outro domínio", "https://evil.example/"],
    ["dupla barra", "//evil.example"],
    ["barra invertida", "/\\evil.example"],
    ["sem barra inicial", "projetos"],
    ["caractere de controle", "/pro\njetos"],
    ["vazio", ""],
    ["não texto", 42],
    ["longo demais", `/${"a".repeat(600)}`],
  ])("recusa %s", (_label, raw) => {
    expect(safeNextPath(raw)).toBe("/");
  });

  it("não volta para as próprias telas de login", () => {
    expect(safeNextPath("/login")).toBe("/");
    expect(safeNextPath("/auth/confirmar?code=1")).toBe("/");
    expect(safeNextPath("/projetos/../login")).toBe("/");
    expect(safeNextPath("/loginho")).toBe("/loginho");
  });

  it("monta o endereço do login guardando o destino e o aviso", () => {
    expect(loginPath()).toBe("/login");
    expect(loginPath("/")).toBe("/login");
    expect(loginPath("/projetos?x=1")).toBe("/login?next=%2Fprojetos%3Fx%3D1");
    expect(loginPath(undefined, "sem-acesso")).toBe("/login?erro=sem-acesso");
    expect(loginPath("//evil.example")).toBe("/login");
  });

  it("só mostra avisos conhecidos", () => {
    expect(loginErrorMessage("sem-acesso")).toMatch(/não tem acesso/);
    expect(loginErrorMessage("<script>")).toBeNull();
    expect(loginErrorMessage(undefined)).toBeNull();
  });
});
