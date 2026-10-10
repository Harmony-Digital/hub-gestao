import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROMPTS, promptTag, type PromptSpec } from "./index";

const changelog = readFileSync(
  path.join(import.meta.dirname, "CHANGELOG.md"),
  "utf8",
);

const fingerprint = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);

/** Linhas da seção de um prompt no histórico. */
function section(id: string): string[] {
  const lines = changelog.split("\n");
  const start = lines.indexOf(`## ${id}`);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end < 0 ? rest : rest.slice(0, end);
}

describe("prompts versionados", () => {
  it("cada prompt tem código único, versão inteira e texto", () => {
    const ids = PROMPTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROMPTS) {
      expect(p.id).toMatch(/^(HUB|[A-Z]{2}-[0-9]{2})\/[a-z0-9-]+$/);
      expect(Number.isInteger(p.version) && p.version >= 1).toBe(true);
      expect(p.instructions.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(PROMPTS.map((p): [string, PromptSpec] => [promptTag(p), p]))(
    "%s está no CHANGELOG com a impressão digital do texto atual",
    (_tag, p) => {
      const lines = section(p.id);
      expect(
        lines.length,
        `falta a seção "## ${p.id}" no CHANGELOG.md`,
      ).toBeGreaterThan(0);
      const entry = lines.find((line) => line.startsWith(`- v${p.version} `));
      expect(
        entry,
        `falta a linha da v${p.version} de ${p.id} no CHANGELOG.md`,
      ).toBeDefined();
      expect(
        entry,
        `o texto de ${p.id} mudou: suba a versão e registre a mudança no CHANGELOG.md`,
      ).toContain(`\`${fingerprint(p.instructions)}\``);
    },
  );
});
