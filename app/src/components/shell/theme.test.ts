import { describe, expect, it } from "vitest";
import { isDark, parseTheme } from "./theme";

describe("tema da interface", () => {
  it("é claro por padrão e aceita só as escolhas conhecidas", () => {
    expect(parseTheme(null)).toBe("claro");
    expect(parseTheme("escuro")).toBe("escuro");
    expect(parseTheme("sistema")).toBe("sistema");
    expect(parseTheme("roxo")).toBe("claro");
  });

  it("escuro sempre escuro; sistema segue o aparelho; claro nunca escuro", () => {
    expect(isDark("escuro", false)).toBe(true);
    expect(isDark("sistema", true)).toBe(true);
    expect(isDark("sistema", false)).toBe(false);
    expect(isDark("claro", true)).toBe(false);
  });
});
