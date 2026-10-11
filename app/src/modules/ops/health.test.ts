import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queueState } from "@/lib/health";
import { inTx } from "@/modules/context";
import { openTestHub, type TestHub } from "@/test/hub";
import { queueSnapshot, readQueue, workspaceIdBySlug } from "./health";

let h: TestHub;

beforeAll(async () => {
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});

describe("fila de jobs para a saúde", () => {
  it("acha o workspace pelo slug, com o papel do app", async () => {
    expect(await workspaceIdBySlug(h.db, "harmony")).toBe(h.ws);
    expect(await workspaceIdBySlug(h.db, "nao-existe")).toBeNull();
  });

  it("lê o último ciclo, os jobs atrasados e as falhas das últimas 24 horas", async () => {
    const before = await queueSnapshot(h.db, h.ws);
    await h.raw.query(
      `insert into proj_hub_gestao.jobs (workspace_id, type, status, run_at, updated_at, last_error)
       values ($1, 'webhook-dispatch', 'done', now() - interval '3 minutes', now() - interval '3 minutes', null),
              ($1, 'health-rollup', 'queued', now() - interval '30 minutes', now() - interval '30 minutes', null),
              ($1, 'health-rollup', 'queued', now() + interval '5 minutes', now(), null),
              ($1, 'webhook-dispatch', 'failed', now() - interval '2 hours', now() - interval '1 hour', 'HTTP 500 do receptor'),
              ($1, 'agent-spend', 'failed', now() - interval '3 days', now() - interval '2 days', 'antigo')`,
      [h.ws],
    );
    const after = await queueSnapshot(h.db, h.ws);
    expect(after.overdue - before.overdue).toBe(1);
    expect(after.failed24h - before.failed24h).toBe(1);
    const age = Date.now() - (after.lastTickAt?.getTime() ?? 0);
    expect(age).toBeGreaterThan(2 * 60_000);
    expect(age).toBeLessThan(4 * 60_000);
    // Job atrasado na fila: parada, mesmo com o relógio em dia.
    expect(queueState(after, new Date())).toBe("stalled");

    // A equipe vê o mesmo na Sala de Controle, com as falhas recentes.
    const view = await inTx(
      {
        db: h.db,
        actor: h.owner_actor,
        source: "ui",
        requestId: "teste-fila",
      },
      readQueue,
    );
    expect(view.overdue).toBe(after.overdue);
    expect(view.failed).toContainEqual({
      type: "webhook-dispatch",
      error: "HTTP 500 do receptor",
      at: expect.any(String),
    });
    expect(view.failed.map((f) => f.error)).not.toContain("antigo");
  });
});
