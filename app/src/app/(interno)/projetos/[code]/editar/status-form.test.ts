import { describe, expect, it } from "vitest";
import {
  moveInOrder,
  parseCreateStatusForm,
  parseRemoveStatusForm,
  parseReorderStatusForm,
  parseUpdateStatusForm,
} from "./status-form";

const A = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
const B = "7b1cc803-4c2f-423e-87dc-33d394046350";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

describe("editor de status", () => {
  it("cria com nome, categoria e cor", () => {
    expect(
      parseCreateStatusForm(
        form({
          project: "VIT",
          name: "  Em teste ",
          category: "review",
          color: "#7e5cc4",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        project: "VIT",
        name: "Em teste",
        category: "review",
        color: "#7E5CC4",
      },
    });
    for (const bad of [
      { project: "VIT", name: "", category: "todo", color: "#000000" },
      { project: "VIT", name: "x", category: "feito", color: "#000000" },
      { project: "VIT", name: "x", category: "todo", color: "azul" },
      { project: "vit", name: "x", category: "todo", color: "#000000" },
      {
        project: "VIT",
        name: "a".repeat(41),
        category: "todo",
        color: "#000000",
      },
    ]) {
      expect(parseCreateStatusForm(form(bad)).ok).toBe(false);
    }
  });

  it("salva nome e cor, ou só torna padrão", () => {
    expect(
      parseUpdateStatusForm(form({ id: A, name: "Feito", color: "#2f8f5b" })),
    ).toEqual({
      ok: true,
      value: { id: A, input: { name: "Feito", color: "#2F8F5B" } },
    });
    expect(parseUpdateStatusForm(form({ id: A, make_default: "1" }))).toEqual({
      ok: true,
      value: { id: A, input: { make_default: true } },
    });
    expect(
      parseUpdateStatusForm(form({ id: "x", name: "a", color: "#000000" })).ok,
    ).toBe(false);
  });

  it("reordena e remove só com identificadores válidos", () => {
    expect(
      parseReorderStatusForm(form({ project: "VIT", ids: `${A},${B}` })),
    ).toEqual({ ok: true, value: { project: "VIT", ids: [A, B] } });
    expect(parseReorderStatusForm(form({ project: "VIT", ids: "x" })).ok).toBe(
      false,
    );
    expect(parseRemoveStatusForm(form({ id: A, move_to: B }))).toEqual({
      ok: true,
      value: { id: A, moveTo: B },
    });
    expect(parseRemoveStatusForm(form({ id: A }))).toEqual({
      ok: true,
      value: { id: A },
    });
    expect(parseRemoveStatusForm(form({ id: A, move_to: "x" })).ok).toBe(false);
  });

  it("sobe e desce na lista, sem passar das pontas", () => {
    expect(moveInOrder(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveInOrder(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveInOrder(["a", "b", "c"], "a", -1)).toBeNull();
    expect(moveInOrder(["a", "b", "c"], "c", 1)).toBeNull();
    expect(moveInOrder(["a"], "z", 1)).toBeNull();
  });
});
