import { describe, expect, it } from "vitest";
import { parseArchiveForm } from "./form";

const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return data;
}

describe("pedido de arquivar ou restaurar", () => {
  it("lê marco, frente e cliente pelo id e projeto pelo código", () => {
    expect(
      parseArchiveForm(form({ entity: "milestone", ref: ID, mode: "archive" })),
    ).toEqual({
      ok: true,
      value: { entity: "milestone", ref: ID, restore: false },
    });
    expect(
      parseArchiveForm(
        form({ entity: "project", ref: "EXE", mode: "restore" }),
      ),
    ).toEqual({
      ok: true,
      value: { entity: "project", ref: "EXE", restore: true },
    });
    expect(
      parseArchiveForm(form({ entity: "client", ref: ID, mode: "restore" })).ok,
    ).toBe(true);
  });

  it("recusa tipo, modo e referência fora do formato", () => {
    const bad = (values: Record<string, string>) =>
      parseArchiveForm(form(values)).ok;
    expect(bad({ entity: "task", ref: ID, mode: "archive" })).toBe(false);
    expect(bad({ entity: "milestone", ref: ID, mode: "delete" })).toBe(false);
    expect(bad({ entity: "milestone", ref: "M2", mode: "archive" })).toBe(
      false,
    );
    expect(bad({ entity: "project", ref: ID, mode: "archive" })).toBe(false);
    expect(bad({ entity: "project", ref: "exe", mode: "archive" })).toBe(false);
  });
});
