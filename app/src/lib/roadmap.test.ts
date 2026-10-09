import { describe, expect, it } from "vitest";
import { roadmap, statusLabel } from "./roadmap";

describe("roadmap", () => {
  it("tem as dez etapas, de M0 a M9, em ordem", () => {
    expect(roadmap.map((m) => m.code)).toEqual([
      "M0",
      "M1",
      "M2",
      "M3",
      "M4",
      "M5",
      "M6",
      "M7",
      "M8",
      "M9",
    ]);
  });

  it("tem exatamente uma etapa em andamento", () => {
    expect(roadmap.filter((m) => m.status === "em-andamento")).toHaveLength(1);
  });

  it("mantém o M9 adiado (decisão D7: uso interno)", () => {
    expect(roadmap.find((m) => m.code === "M9")?.status).toBe("adiado");
  });

  it("tem rótulo em português para todo status usado", () => {
    for (const m of roadmap) {
      expect(statusLabel[m.status]).toBeTruthy();
    }
  });
});
