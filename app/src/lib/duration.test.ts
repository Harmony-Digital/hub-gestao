import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration } from "./duration";

describe("duração escrita", () => {
  it("lê minutos, horas e as formas comuns", () => {
    const cases: [string, number | null][] = [
      ["", null],
      ["  ", null],
      ["90", 90],
      ["1h", 60],
      ["1h30", 90],
      ["1h 30min", 90],
      ["1h30m", 90],
      ["2 horas e 15 minutos", 135],
      ["1:30", 90],
      ["0:45", 45],
      ["1,5h", 90],
      ["1.5 h", 90],
      ["45 min", 45],
      ["45min", 45],
      ["10 minutos", 10],
    ];
    for (const [text, minutes] of cases) {
      expect(parseDuration(text), text).toBe(minutes);
    }
  });

  it("recusa o que não é duração", () => {
    for (const text of ["uma hora", "1:75", "h", "abc", "1h30x", "-5"]) {
      expect(parseDuration(text), text).toBe("invalida");
    }
  });

  it("escreve curto", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h30");
    expect(formatDuration(725)).toBe("12h05");
    expect(formatDuration(0)).toBe("0 min");
  });
});
