import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O Hub serve a CLI hub em /cli/hub.mjs (app/public/cli), para as Actions dos outros
 * repositórios baixarem. A fonte fica em packages/cli; a cópia tem de ser igual.
 */
describe("CLI servida pelo Hub", () => {
  it("public/cli/hub.mjs é igual a packages/cli/hub.mjs", () => {
    const app = path.resolve(import.meta.dirname, "../..");
    const served = readFileSync(path.join(app, "public/cli/hub.mjs"), "utf8");
    const source = readFileSync(
      path.join(app, "../packages/cli/hub.mjs"),
      "utf8",
    );
    expect(served).toBe(source);
  });
});
