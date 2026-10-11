import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  PERMISSIONS_POLICY,
  securityHeaders,
} from "./security-headers";

const directive = (csp: string, name: string) =>
  csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `) || d === name);

describe("cabeçalhos de segurança", () => {
  it("em produção: tudo na própria origem, sem eval, sem quadro e sem objeto", () => {
    const csp = contentSecurityPolicy("production");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "script-src")).toBe(
      "script-src 'self' 'unsafe-inline'",
    );
    expect(directive(csp, "connect-src")).toBe("connect-src 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "upgrade-insecure-requests")).toBeDefined();
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/https?:|\*/);
  });

  it("em desenvolvimento: eval do React e o WebSocket do recarregamento", () => {
    const csp = contentSecurityPolicy("development");
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' ws: wss:");
    expect(directive(csp, "upgrade-insecure-requests")).toBeUndefined();
  });

  it("microfone só na própria origem (ditado do Concierge); câmera e local, não", () => {
    expect(PERMISSIONS_POLICY).toContain("microphone=(self)");
    expect(PERMISSIONS_POLICY).toContain("camera=()");
    expect(PERMISSIONS_POLICY).toContain("geolocation=()");
    expect(securityHeaders("production").map((h) => h.key)).toEqual([
      "Content-Security-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
    ]);
  });
});
