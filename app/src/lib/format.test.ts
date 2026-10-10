import { describe, expect, it } from "vitest";
import {
  formatAge,
  formatDate,
  formatDayMonth,
  formatLongDate,
  formatMoment,
  formatTimestampDay,
  greetingFor,
  initials,
  todayKey,
} from "./format";

describe("datas nas telas", () => {
  it("data pura não muda de dia por fuso", () => {
    expect(formatDate("2026-10-24")).toBe("24/10/2026");
    expect(formatDayMonth("2026-01-01")).toBe("01/01");
    expect(formatDate(null)).toBe("");
    expect(formatDate("24/10/2026")).toBe("");
  });

  it("momento mostra a hora de hoje em Brasília, ontem ou o dia", () => {
    const now = new Date("2026-10-10T15:00:00Z"); // 12:00 em Brasília
    expect(formatMoment("2026-10-10T13:40:00Z", now)).toBe("10:40");
    // 01:00 UTC de 10/10 ainda é 9/10 em Brasília: ontem.
    expect(formatMoment("2026-10-10T01:00:00Z", now)).toBe("ontem");
    expect(formatMoment("2026-10-01T12:00:00Z", now)).toBe("01/10");
  });

  it("dia de um instante segue Brasília", () => {
    expect(formatTimestampDay("2026-10-10T01:26:16Z")).toBe("09/10");
    expect(formatTimestampDay("2026-10-10T15:00:00Z")).toBe("10/10");
  });

  it("data por extenso e saudação seguem o relógio de Brasília", () => {
    // 02:30 UTC de 10/10 ainda é a noite de sexta, 9/10, em Brasília.
    expect(formatLongDate(new Date("2026-10-10T02:30:00Z"))).toBe(
      "Sexta-feira, 9 de outubro",
    );
    expect(formatLongDate(new Date("2026-10-10T15:00:00Z"))).toBe(
      "Sábado, 10 de outubro",
    );
    expect(greetingFor(new Date("2026-10-10T10:59:00Z"))).toBe("Bom dia"); // 07:59
    expect(greetingFor(new Date("2026-10-10T15:00:00Z"))).toBe("Boa tarde"); // 12:00
    expect(greetingFor(new Date("2026-10-10T21:00:00Z"))).toBe("Boa noite"); // 18:00
    expect(greetingFor(new Date("2026-10-10T02:30:00Z"))).toBe("Boa noite"); // 23:30
    expect(todayKey(new Date("2026-10-10T02:30:00Z"))).toBe("2026-10-09");
  });

  it("há quanto tempo, em palavras", () => {
    const now = new Date("2026-10-10T15:00:00Z"); // 12:00 em Brasília
    expect(formatAge("2026-10-10T14:59:40Z", now)).toBe("agora");
    expect(formatAge("2026-10-10T15:05:00Z", now)).toBe("agora");
    expect(formatAge("2026-10-10T14:55:00Z", now)).toBe("há 5 min");
    expect(formatAge("2026-10-10T12:30:00Z", now)).toBe("há 2 h");
    expect(formatAge("2026-10-10T01:00:00Z", now)).toBe("ontem"); // 22:00 de 9/10
    expect(formatAge("2026-10-07T15:00:00Z", now)).toBe("há 3 dias");
    expect(formatAge("2026-09-20T15:00:00Z", now)).toBe("20/09");
  });
});

describe("iniciais", () => {
  it.each([
    ["Fábio Almeida", "FA"],
    ["Kratos", "K"],
    ["Claude Code do Fábio", "CF"],
    ["Codex (exemplo)", "C"],
    ["Kratos (exemplo)", "K"],
    ["  ", "?"],
    [null, "?"],
  ])("%s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
