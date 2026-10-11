import { describe, expect, it } from "vitest";
import { buildHealth, queueState, STALL_MINUTES } from "./health";

describe("buildHealth", () => {
  const now = new Date("2026-10-09T15:00:00.000Z");
  const fine = { database: "ok", queue: "ok" } as const;

  it("usa o SHA publicado como versão", () => {
    expect(buildHealth({ APP_VERSION: "3f9a2c1" }, now, fine)).toEqual({
      ok: true,
      service: "hub-gestao",
      version: "3f9a2c1",
      time: "2026-10-09T15:00:00.000Z",
      status: "ok",
      checks: { database: "ok", queue: "ok" },
    });
  });

  it("cai para 'local' quando não há versão ou ela está em branco", () => {
    expect(buildHealth({}, now, fine).version).toBe("local");
    expect(buildHealth({ APP_VERSION: "   " }, now, fine).version).toBe(
      "local",
    );
  });

  it("o processo responde (ok) mesmo com o banco fora; o status diz o resto", () => {
    const down = buildHealth({}, now, { database: "down", queue: "unknown" });
    expect(down.ok).toBe(true);
    expect(down.status).toBe("down");
    expect(
      buildHealth({}, now, { database: "ok", queue: "stalled" }).status,
    ).toBe("degraded");
    expect(
      buildHealth({}, now, { database: "ok", queue: "failing" }).status,
    ).toBe("degraded");
    expect(
      buildHealth({}, now, { database: "ok", queue: "unknown" }).status,
    ).toBe("ok");
  });
});

describe("queueState", () => {
  const now = new Date("2026-10-09T15:00:00.000Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("relógio em dia, sem atraso nem falha: ok", () => {
    expect(
      queueState({ lastTickAt: ago(4), overdue: 0, failed24h: 0 }, now),
    ).toBe("ok");
  });

  it("parada sem ciclo há mais de 15 minutos ou com job atrasado", () => {
    expect(
      queueState(
        { lastTickAt: ago(STALL_MINUTES + 1), overdue: 0, failed24h: 0 },
        now,
      ),
    ).toBe("stalled");
    expect(
      queueState({ lastTickAt: ago(2), overdue: 3, failed24h: 0 }, now),
    ).toBe("stalled");
    expect(
      queueState({ lastTickAt: null, overdue: 1, failed24h: 0 }, now),
    ).toBe("stalled");
  });

  it("com falha nas últimas 24 horas; desconhecida antes do primeiro ciclo", () => {
    expect(
      queueState({ lastTickAt: ago(3), overdue: 0, failed24h: 2 }, now),
    ).toBe("failing");
    expect(
      queueState({ lastTickAt: null, overdue: 0, failed24h: 0 }, now),
    ).toBe("unknown");
  });
});
