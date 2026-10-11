import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");

describe("campos no iPhone", () => {
  it("têm pelo menos 16 px no Safari do iOS, para a tela não aproximar ao tocar", () => {
    const block = css.slice(
      css.indexOf("@supports (-webkit-touch-callout: none)"),
    );
    expect(block).toMatch(
      /input,\s*select,\s*textarea\s*\{[^}]*font-size:\s*max\(16px/,
    );
  });
});
