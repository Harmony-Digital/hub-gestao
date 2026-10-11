import { describe, expect, it } from "vitest";
import {
  parseCreateFieldForm,
  parseRemoveFieldForm,
  parseUpdateFieldForm,
} from "./fields-form";

const A = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

describe("campos das tarefas", () => {
  it("cria seleção com as opções, uma por linha, sem repetir", () => {
    expect(
      parseCreateFieldForm(
        form({
          project: "VIT",
          name: "  Canal ",
          kind: "select",
          options: "Site\r\n WhatsApp \n\nSite\nIndicação",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        project: "VIT",
        name: "Canal",
        kind: "select",
        options: ["Site", "WhatsApp", "Indicação"],
      },
    });
  });

  it("campo que não é seleção não leva opções", () => {
    const r = parseCreateFieldForm(
      form({ project: "VIT", name: "Valor", kind: "number", options: "a" }),
    );
    expect(r.ok && r.value.options).toEqual([]);
  });

  it("recusa nome vazio, tipo desconhecido e seleção sem opções", () => {
    const bad = (over: Record<string, string>) =>
      parseCreateFieldForm(
        form({ project: "VIT", name: "Canal", kind: "text", ...over }),
      ).ok;
    expect(bad({})).toBe(true);
    expect(bad({ name: " " })).toBe(false);
    expect(bad({ name: "x".repeat(61) })).toBe(false);
    expect(bad({ kind: "cor" })).toBe(false);
    expect(bad({ kind: "select", options: " \n " })).toBe(false);
    expect(bad({ kind: "select", options: "x".repeat(61) })).toBe(false);
    expect(
      bad({
        kind: "select",
        options: Array.from({ length: 31 }, (_, i) => `O${i}`).join("\n"),
      }),
    ).toBe(false);
    expect(bad({ project: "vit" })).toBe(false);
  });

  it("edita nome e opções; remove pelo id", () => {
    expect(
      parseUpdateFieldForm(form({ id: A, name: " Origem ", options: "A\nB" })),
    ).toEqual({
      ok: true,
      value: { id: A, name: "Origem", options: ["A", "B"] },
    });
    expect(parseUpdateFieldForm(form({ id: "x", name: "Origem" })).ok).toBe(
      false,
    );
    expect(parseRemoveFieldForm(form({ id: A }))).toEqual({
      ok: true,
      value: { id: A },
    });
    expect(parseRemoveFieldForm(form({ id: "" })).ok).toBe(false);
  });
});
