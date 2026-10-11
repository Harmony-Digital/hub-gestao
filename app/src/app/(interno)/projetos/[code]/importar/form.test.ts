import { describe, expect, it } from "vitest";
import { IMPORT_MAX, parseImportForm } from "./form";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

describe("formulário de importação do plan.md", () => {
  it("lê o projeto, o texto e a intenção (prévia por padrão)", () => {
    expect(
      parseImportForm(form({ project: "HUB", markdown: "## M1\n" })),
    ).toEqual({
      ok: true,
      value: {
        project: "HUB",
        markdown: "## M1\n",
        intent: "preview",
        template: null,
      },
    });
    expect(
      parseImportForm(
        form({ project: "HUB", markdown: "## M1\n", intent: "import" }),
      ),
    ).toMatchObject({ ok: true, value: { intent: "import" } });
  });

  it("lê o modelo de onde veio o texto (RF-36), só se for um id", () => {
    const id = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
    expect(
      parseImportForm(
        form({ project: "HUB", markdown: "## M1\n", modelo: id }),
      ),
    ).toMatchObject({ ok: true, value: { template: id } });
    expect(
      parseImportForm(
        form({ project: "HUB", markdown: "## M1\n", modelo: "x' or 1=1" }),
      ),
    ).toMatchObject({ ok: true, value: { template: null } });
  });

  it("volta as quebras do envio (\\r\\n) para \\n", () => {
    expect(
      parseImportForm(
        form({ project: "HUB", markdown: "## M1\r\n- [ ] a\r\n" }),
      ),
    ).toMatchObject({ ok: true, value: { markdown: "## M1\n- [ ] a\n" } });
  });

  it("recusa projeto inválido, texto vazio e texto grande demais", () => {
    expect(
      parseImportForm(form({ project: "x", markdown: "a" })),
    ).toMatchObject({ ok: false });
    expect(
      parseImportForm(form({ project: "HUB", markdown: "  \n" })),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/Cole/) });
    expect(
      parseImportForm(
        form({ project: "HUB", markdown: "a".repeat(IMPORT_MAX + 1) }),
      ),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/1 milhão/) });
  });
});
