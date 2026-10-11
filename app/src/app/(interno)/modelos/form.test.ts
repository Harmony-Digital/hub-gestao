import { describe, expect, it } from "vitest";
import {
  parseProjectTemplateForm,
  parseRemoveTemplateForm,
  parseTemplateForm,
} from "./form";

const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";

function form(values: [string, string][]): FormData {
  const data = new FormData();
  for (const [key, value] of values) data.append(key, value);
  return data;
}

describe("formulário de modelo", () => {
  it("lê nome, descrição, departamentos e o esqueleto (com as quebras de linha do navegador)", () => {
    expect(
      parseTemplateForm(
        form([
          ["id", ID],
          ["name", "  Site institucional "],
          ["description", "Site da empresa.\r\n"],
          ["departments", "design"],
          ["departments", "design"],
          ["departments", "sistemas"],
          ["markdown", "## M1 — A\r\n- [ ] Fazer\r\n\r\n"],
        ]),
      ),
    ).toEqual({
      ok: true,
      value: {
        id: ID,
        input: {
          name: "Site institucional",
          description: "Site da empresa.",
          markdown: "## M1 — A\n- [ ] Fazer\n",
          departments: ["design", "sistemas"],
        },
      },
    });
  });

  it("recusa sem nome, sem esqueleto, nome em várias linhas e departamento estranho", () => {
    const ok = (values: [string, string][]) =>
      parseTemplateForm(form(values)).ok;
    const base: [string, string][] = [
      ["name", "Modelo"],
      ["markdown", "## M1 — A\n- [ ] Fazer"],
    ];
    expect(ok(base)).toBe(true);
    expect(ok([["markdown", "## M1 — A\n- [ ] Fazer"]])).toBe(false);
    expect(ok([["name", "Modelo"]])).toBe(false);
    expect(ok([["name", "Mo\ndelo"], base[1]])).toBe(false);
    expect(ok([...base, ["departments", "Design"]])).toBe(false);
    expect(ok([...base, ["id", "x"]])).toBe(false);
  });

  it("salvar projeto como modelo e remover: só o essencial", () => {
    expect(
      parseProjectTemplateForm(
        form([
          ["project", "EXE"],
          ["name", " Atendimento "],
          ["description", ""],
        ]),
      ),
    ).toEqual({
      ok: true,
      value: { project: "EXE", name: "Atendimento", description: null },
    });
    expect(parseProjectTemplateForm(form([["project", "exe"]])).ok).toBe(false);
    expect(parseRemoveTemplateForm(form([["id", ID]]))).toEqual({
      ok: true,
      value: { id: ID },
    });
    expect(parseRemoveTemplateForm(form([["id", "1"]])).ok).toBe(false);
  });
});
