import { describe, expect, it } from "vitest";
import {
  bearerToken,
  generateAgentKey,
  hashAgentKey,
  parseAgentKey,
  verifyAgentKey,
} from "./agent-keys";

const PEPPER = "pepper-de-teste-com-mais-de-32-caracteres-0123456789";

describe("chaves de agente", () => {
  it("gera chave no formato hub_ak_<prefixo>.<segredo> e guarda só o hash", () => {
    const { key, prefix, hash } = generateAgentKey(PEPPER);
    expect(key).toMatch(/^hub_ak_[a-z0-9]{12}\.[A-Za-z0-9_-]{43}$/);
    expect(key.startsWith(`${prefix}.`)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key.split(".")[1]);
  });

  it("gera chaves diferentes a cada vez", () => {
    const a = generateAgentKey(PEPPER);
    const b = generateAgentKey(PEPPER);
    expect(a.prefix).not.toBe(b.prefix);
    expect(a.key).not.toBe(b.key);
  });

  it("confere a chave certa e recusa chave alterada ou pepper diferente", () => {
    const { key, hash } = generateAgentKey(PEPPER);
    expect(verifyAgentKey(key, hash, PEPPER)).toBe(true);
    expect(verifyAgentKey(`${key}x`, hash, PEPPER)).toBe(false);
    expect(verifyAgentKey(key, hash, `${PEPPER}-outro`)).toBe(false);
    expect(verifyAgentKey(key, "00", PEPPER)).toBe(false);
  });

  it("recusa pepper curto", () => {
    expect(() => hashAgentKey("hub_ak_x.y", "curto")).toThrow(
      /HUB_API_KEY_PEPPER/,
    );
  });

  it("lê o cabeçalho Bearer e o formato da chave", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer   abc  ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(null)).toBeNull();
    expect(
      parseAgentKey(
        "hub_ak_abcdefgh1234.segredo-com-mais-de-trinta-e-dois-caracteres",
      ),
    ).toEqual({
      key: "hub_ak_abcdefgh1234.segredo-com-mais-de-trinta-e-dois-caracteres",
      prefix: "hub_ak_abcdefgh1234",
    });
    expect(parseAgentKey("hub_ak_ABC.curto")).toBeNull();
  });
});
