import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDayMonth,
  formatMoment,
  formatTimestampDay,
  initials,
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
});

describe("iniciais", () => {
  it.each([
    ["Fábio Almeida", "FA"],
    ["Kratos", "K"],
    ["Claude Code do Fábio", "CF"],
    ["  ", "?"],
    [null, "?"],
  ])("%s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
