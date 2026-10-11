import { describe, expect, it } from "vitest";
import { monthLabel, monthWeeks, readMonth, shiftMonth } from "./calendar-grid";

describe("grade do calendário", () => {
  it("lê o mês do endereço ou usa o de hoje", () => {
    expect(readMonth("2026-11", "2026-10-10")).toBe("2026-11");
    expect(readMonth("2026-13", "2026-10-10")).toBe("2026-10");
    expect(readMonth(undefined, "2026-10-10")).toBe("2026-10");
  });

  it("anda pelos meses, virando o ano", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("semanas de segunda a domingo, cobrindo o mês inteiro", () => {
    // Outubro de 2026 começa numa quinta e termina num sábado.
    const weeks = monthWeeks("2026-10");
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(weeks.at(-1)?.at(-1)).toBe("2026-11-01");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // Fevereiro de 2027 começa numa segunda e tem 4 semanas exatas.
    expect(monthWeeks("2027-02")).toHaveLength(4);
  });

  it("nome do mês em PT-BR", () => {
    expect(monthLabel("2026-10")).toBe("outubro de 2026");
  });
});
