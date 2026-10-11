import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret, parseEncryptionKey } from "@/lib/crypto";
import { inTx } from "@/modules/context";
import { tick } from "@/modules/jobs/service";
import { createTask, blockTask } from "@/modules/tasks/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";

const S = "proj_hub_gestao";
let h: TestHub;
const key = parseEncryptionKey(Buffer.alloc(32, 3).toString("base64"));

beforeAll(async () => {
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});

describe("fila de jobs", () => {
  it("o primeiro tick agenda e roda os periódicos; o seguinte não repete antes do intervalo", async () => {
    const first = await tick(h.db, h.ws, { encryptionKey: key });
    expect(first.enqueued.sort()).toEqual(
      [
        "agent-spend",
        "approval-aging",
        "evidence-check",
        "health-rollup",
        "idempotency-cleanup",
        "ops-watch",
        "retention",
        "webhook-dispatch",
      ].sort(),
    );
    expect(first.ran.every((r) => r.status === "done")).toBe(true);
    const second = await tick(h.db, h.ws, { encryptionKey: key });
    expect(second.enqueued).toEqual([]);
    expect(second.ran).toEqual([]);
  });

  it("conclusão sem evidência em projeto que exige é reaberta, com comentário e aviso", async () => {
    // Concluída quando o projeto ainda não exigia evidência; depois passou a exigir.
    const owner = ctxFor(h, h.owner_actor, "ui");
    const task = await inTx(owner, (t) =>
      createTask(t, { project: "VIT", title: "Concluída sem prova" }),
    );
    await h.raw.query(
      `update ${S}.projects set require_evidence = false where id = $1`,
      [h.vit],
    );
    await h.raw.query(
      `update ${S}.tasks set status_id = (
         select id from ${S}.task_statuses where project_id = $1 and category = 'done' limit 1)
        where code = $2`,
      [h.vit, task.code],
    );
    await h.raw.query(
      `update ${S}.projects set require_evidence = true where id = $1`,
      [h.vit],
    );
    await h.raw.query(
      `delete from ${S}.jobs where type = 'evidence-check' and status = 'done'`,
    );
    const result = await tick(h.db, h.ws, { encryptionKey: key });
    const check = result.ran.find((r) => r.type === "evidence-check");
    expect(check?.result).toEqual({ reopened: [task.code] });
    const row = await h.raw.query<{ status_category: string }>(
      `select status_category from ${S}.tasks where code = $1`,
      [task.code],
    );
    expect(row.rows[0].status_category).toBe("todo");
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.comments c join ${S}.tasks k on k.id = c.entity_id
          where k.code = $1 and c.body_md like 'Reaberta: concluída sem evidência%'`,
        [task.code],
      ),
    ).toBe(1);
    // Sem responsável: o aviso vai para o dono.
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.notifications
          where type = 'task.reopened' and profile_id = $1 and payload ->> 'task_code' = $2`,
        [h.owner, task.code],
      ),
    ).toBe(1);
  });

  it("saúde muda quando muitas tarefas ficam bloqueadas, com registro e evento", async () => {
    const kratos = await agentActor(h, h.keys.kratos);
    const ctx = ctxFor(h, kratos);
    for (let i = 0; i < 3; i++) {
      const task = await inTx(ctx, (t) =>
        createTask(t, { project: "VIT", title: `Bloqueada ${i}` }),
      );
      await inTx(ctx, (t) =>
        blockTask(t, task.code, { reason: "Aguardando o cliente" }),
      );
    }
    await h.raw.query(
      `delete from ${S}.jobs where type = 'health-rollup' and status = 'done'`,
    );
    const result = await tick(h.db, h.ws, { encryptionKey: key });
    const health = result.ran.find((r) => r.type === "health-rollup");
    expect(health?.result).toMatchObject({ changed: ["VIT"] });
    const p = await h.raw.query<{ health: string }>(
      `select health from ${S}.projects where id = $1`,
      [h.vit],
    );
    expect(p.rows[0].health).toBe("at_risk");
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log where action = 'project.health_changed' and actor_type = 'system'`,
      ),
    ).toBe(1);
  });

  it("entrega webhooks assinados e tenta de novo quando falha", async () => {
    await h.raw.query(
      `insert into ${S}.webhooks (workspace_id, url, events, secret_ciphertext)
       values ($1, 'https://hermes.exemplo/hook', array['task.created'], $2)`,
      [h.ws, encryptSecret("segredo-do-hermes", key)],
    );
    const kratos = await agentActor(h, h.keys.kratos);
    await inTx(ctxFor(h, kratos), (t) =>
      createTask(t, { project: "VIT", title: "Gera evento" }),
    );

    const calls: {
      url: string;
      headers: Record<string, string>;
      body: string;
    }[] = [];
    let respond = 500;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      });
      return new Response(null, { status: respond });
    }) as unknown as typeof fetch;

    await h.raw.query(
      `delete from ${S}.jobs where type = 'webhook-dispatch' and status = 'done'`,
    );
    const failed = await tick(h.db, h.ws, {
      encryptionKey: key,
      fetch: fakeFetch,
    });
    expect(
      failed.ran.find((r) => r.type === "webhook-dispatch")?.result,
    ).toMatchObject({ failed: 1 });
    expect(calls[0].headers["Hub-Signature"]).toMatch(/^sha256=/);
    expect(JSON.parse(calls[0].body)).toMatchObject({
      event: "task.created",
      data: { project_code: "VIT" },
    });

    respond = 200;
    await h.raw.query(
      `update ${S}.webhook_deliveries set next_attempt_at = now() - interval '1 minute'`,
    );
    await h.raw.query(
      `delete from ${S}.jobs where type = 'webhook-dispatch' and status = 'done'`,
    );
    const ok = await tick(h.db, h.ws, { encryptionKey: key, fetch: fakeFetch });
    expect(
      ok.ran.find((r) => r.type === "webhook-dispatch")?.result,
    ).toMatchObject({ delivered: 1 });
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.webhook_deliveries where delivered_at is not null`,
      ),
    ).toBe(1);
  });

  it("limpa chaves de idempotência vencidas", async () => {
    const kratos = await agentActor(h, h.keys.kratos);
    await h.raw.query(
      `insert into ${S}.idempotency_keys (workspace_id, actor_id, key, request_hash, response_status, response_body, expires_at)
       values ($1, $2, 'vencida-00001', 'h', 200, '{}'::jsonb, now() - interval '1 hour')`,
      [h.ws, kratos.id],
    );
    await h.raw.query(
      `delete from ${S}.jobs where type = 'idempotency-cleanup' and status = 'done'`,
    );
    await tick(h.db, h.ws, { encryptionKey: key });
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.idempotency_keys where key = 'vencida-00001'`,
      ),
    ).toBe(0);
  });
});
