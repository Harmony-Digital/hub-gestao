import { describe, expect, it } from "vitest";
import { parseReportForm } from "./form";

const fd = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.append(k, v);
  return data;
};
const base = {
  project: "tsite",
  start: "2026-10-05",
  end: "2026-10-11",
  audience: "client",
};

describe("formulário de Preparar relatório", () => {
  it("lê projeto, período, para quem e o texto", () => {
    expect(
      parseReportForm(fd({ ...base, body: " Texto. " }), { needBody: true }),
    ).toEqual({
      ok: true,
      value: {
        project: "TSITE",
        start: "2026-10-05",
        end: "2026-10-11",
        audience: "client",
        body: "Texto.",
      },
    });
  });

  it("para montar o resumo, o texto pode faltar; para mandar, não", () => {
    expect(parseReportForm(fd(base), { needBody: false }).ok).toBe(true);
    const missing = parseReportForm(fd(base), { needBody: true });
    expect(missing.ok ? "" : missing.message).toMatch(/Montar o resumo/);
  });

  it("recusa período invertido, público desconhecido e projeto vazio", () => {
    expect(
      parseReportForm(fd({ ...base, start: "2026-10-12" }), { needBody: false })
        .ok,
    ).toBe(false);
    expect(
      parseReportForm(fd({ ...base, audience: "todos" }), { needBody: false })
        .ok,
    ).toBe(false);
    expect(
      parseReportForm(fd({ ...base, project: "" }), { needBody: false }).ok,
    ).toBe(false);
  });
});
