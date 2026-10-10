import { afterEach, describe, expect, it, vi } from "vitest";
import {
  devLoginCookieValue,
  devLoginEnabled,
  isValidDevLogin,
} from "./dev-login";

const SECRET = "segredo-local-de-teste-com-mais-de-32-caracteres";

afterEach(() => {
  vi.unstubAllEnvs();
});

function ligar() {
  vi.stubEnv("HUB_DEV_LOGIN", "on");
  vi.stubEnv("HUB_DEV_LOGIN_SECRET", SECRET);
}

describe("login de teste local", () => {
  it("fica desligado sem configuração", () => {
    vi.stubEnv("HUB_DEV_LOGIN", "");
    expect(devLoginEnabled()).toBe(false);
    expect(devLoginCookieValue()).toBeNull();
  });

  it("exige segredo de 32 caracteres ou mais", () => {
    vi.stubEnv("HUB_DEV_LOGIN", "on");
    vi.stubEnv("HUB_DEV_LOGIN_SECRET", "curto");
    expect(devLoginEnabled()).toBe(false);
  });

  it("aceita só o cookie assinado com o segredo", () => {
    ligar();
    const value = devLoginCookieValue();
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isValidDevLogin(value)).toBe(true);
    expect(isValidDevLogin(`${value}x`)).toBe(false);
    expect(isValidDevLogin("qualquer")).toBe(false);
    expect(isValidDevLogin(undefined)).toBe(false);
  });

  it("nunca vale em produção, nem com tudo configurado", () => {
    ligar();
    const value = devLoginCookieValue();
    vi.stubEnv("NODE_ENV", "production");
    expect(devLoginEnabled()).toBe(false);
    expect(devLoginCookieValue()).toBeNull();
    expect(isValidDevLogin(value)).toBe(false);
  });

  it("outro segredo não aceita o cookie antigo", () => {
    ligar();
    const value = devLoginCookieValue();
    vi.stubEnv("HUB_DEV_LOGIN_SECRET", `${SECRET}-novo`);
    expect(isValidDevLogin(value)).toBe(false);
  });
});
