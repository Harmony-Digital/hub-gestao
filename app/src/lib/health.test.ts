import { describe, expect, it } from "vitest";
import { buildHealth } from "./health";

describe("buildHealth", () => {
  const now = new Date("2026-10-09T15:00:00.000Z");

  it("usa o SHA publicado como versão", () => {
    expect(buildHealth({ APP_VERSION: "3f9a2c1" }, now)).toEqual({
      ok: true,
      service: "hub-gestao",
      version: "3f9a2c1",
      time: "2026-10-09T15:00:00.000Z",
    });
  });

  it("cai para 'local' quando não há versão ou ela está em branco", () => {
    expect(buildHealth({}, now).version).toBe("local");
    expect(buildHealth({ APP_VERSION: "   " }, now).version).toBe("local");
  });
});
