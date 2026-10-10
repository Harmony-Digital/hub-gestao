import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Identidade Harmony no código das telas: sem emojis na interface, as cores da marca nos
 * tokens e as três fontes no layout. A conferência no navegador (fonte e cor desenhadas
 * de fato) fica no teste de ponta a ponta `e2e/identidade.spec.ts`.
 */

const SRC = path.resolve(import.meta.dirname, "..");
// Pictogramas, símbolos e o seletor que transforma um caractere em emoji.
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

describe("identidade Harmony", () => {
  it("não tem emojis nas telas nem nos componentes", () => {
    const found = ["app", "components"]
      .flatMap((dir) => sources(path.join(SRC, dir)))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, i) =>
            EMOJI.test(line) ? [`${path.relative(SRC, file)}:${i + 1}`] : [],
          ),
      );
    expect(found).toEqual([]);
  });

  it("usa as cores da marca nos tokens", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");
    expect(css).toMatch(/--color-navy:\s*#151a2d;/i);
    expect(css).toMatch(/--color-off:\s*#faf8f4;/i);
    expect(css).toMatch(/--color-brand:\s*#f28c1d;/i);
  });

  it("carrega Sora, DM Sans e JetBrains Mono no layout", () => {
    const layout = readFileSync(path.join(SRC, "app/layout.tsx"), "utf8");
    for (const font of ["Sora", "DM_Sans", "JetBrains_Mono"]) {
      expect(layout).toContain(font);
    }
  });
});
