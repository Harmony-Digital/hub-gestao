import { describe, expect, it } from "vitest";
import { displayFieldValue, normalizeFieldValue } from "./custom-field-kinds";

const field = (
  kind: "text" | "number" | "select" | "date" | "url",
  options: string[] = [],
) => ({ name: "Campo", kind, options });

describe("valor de campo personalizado", () => {
  it("vazio tira o valor; texto numa linha só", () => {
    expect(normalizeFieldValue(field("text"), "  ")).toEqual({
      ok: true,
      value: null,
    });
    expect(normalizeFieldValue(field("text"), null)).toEqual({
      ok: true,
      value: null,
    });
    expect(normalizeFieldValue(field("text"), " WhatsApp ")).toEqual({
      ok: true,
      value: "WhatsApp",
    });
    expect(normalizeFieldValue(field("text"), "a\nb").ok).toBe(false);
  });

  it("número em pt-BR ou com ponto, guardado com ponto", () => {
    const n = (raw: string | number) =>
      normalizeFieldValue(field("number"), raw);
    expect(n("1.250")).toEqual({ ok: true, value: "1250" });
    expect(n("1.234,5")).toEqual({ ok: true, value: "1234.5" });
    expect(n("12,5")).toEqual({ ok: true, value: "12.5" });
    expect(n("12.5")).toEqual({ ok: true, value: "12.5" });
    expect(n(42)).toEqual({ ok: true, value: "42" });
    expect(n("-3")).toEqual({ ok: true, value: "-3" });
    expect(n("doze").ok).toBe(false);
    expect(n("1,2,3").ok).toBe(false);
  });

  it("data de verdade, URL http(s) e opção que existe", () => {
    expect(normalizeFieldValue(field("date"), "2026-10-31")).toEqual({
      ok: true,
      value: "2026-10-31",
    });
    expect(normalizeFieldValue(field("date"), "2026-02-30").ok).toBe(false);
    expect(normalizeFieldValue(field("date"), "31/10/2026").ok).toBe(false);
    expect(normalizeFieldValue(field("url"), "https://a.com/x")).toEqual({
      ok: true,
      value: "https://a.com/x",
    });
    expect(normalizeFieldValue(field("url"), "ftp://a.com").ok).toBe(false);
    const select = field("select", ["Site", "WhatsApp"]);
    expect(normalizeFieldValue(select, "Site")).toEqual({
      ok: true,
      value: "Site",
    });
    expect(normalizeFieldValue(select, "Telefone")).toEqual({
      ok: false,
      message: "Campo: escolha uma das opções (Site, WhatsApp).",
    });
  });

  it("mostra número e data como se lê no Brasil", () => {
    expect(displayFieldValue("number", "1234.5")).toBe("1.234,5");
    expect(displayFieldValue("date", "2026-10-31")).toBe("31/10/2026");
    expect(displayFieldValue("text", "Site")).toBe("Site");
  });
});
