import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { tick } from "@/modules/jobs/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";
import {
  assertPublicUrl,
  createWebhook,
  listWebhooks,
  rotateWebhookSecret,
  sendWebhookTest,
  setWebhookActive,
} from "./service";

const S = "proj_hub_gestao";
const KEY = Buffer.alloc(32, 3);
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

beforeAll(async () => {
  process.env.HUB_ENCRYPTION_KEY = KEY.toString("base64");
  h = await openTestHub();
});

afterAll(async () => {
  await h.db.close();
});

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

describe("webhooks de saída", () => {
  it("só endereço público e com https", () => {
    for (const ok of [
      "https://hermes.harmonydigital.com.br/hub",
      "https://203.0.113.9/hook",
    ]) {
      expect(() => assertPublicUrl(ok)).not.toThrow();
    }
    for (const bad of [
      "http://hermes.exemplo.com/hook",
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://172.20.1.1/hook",
      "https://192.168.0.10/hook",
      "https://169.254.169.254/latest",
      "https://[::1]/hook",
      "https://hub.internal/hook",
      "https://usuario:senha@hermes.exemplo.com/hook",
    ]) {
      expect(() => assertPublicUrl(bad), bad).toThrow();
    }
  });

  it("cadastra com o segredo uma vez só, cifrado no banco e fora do histórico", async () => {
    const made = await inTx(asOwner(), (t) =>
      createWebhook(t, {
        url: "https://hermes.exemplo.com.br/hub",
        events: ["agent.budget_exceeded", "approval.requested"],
      }),
    );
    expect(made.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    const row = await h.raw.query<{
      secret_ciphertext: string;
      events: string[];
    }>(`select secret_ciphertext, events from ${S}.webhooks where id = $1`, [
      made.id,
    ]);
    expect(row.rows[0].secret_ciphertext).not.toContain(made.secret);
    // Os eventos ficam na ordem da lista do Hub.
    expect(row.rows[0].events).toEqual([
      "approval.requested",
      "agent.budget_exceeded",
    ]);
    const log = await h.raw.query<{ after: unknown }>(
      `select after from ${S}.activity_log where entity_id = $1`,
      [made.id],
    );
    expect(JSON.stringify(log.rows)).not.toContain(made.secret);
    // Mesmo endereço ativo de novo: recusa.
    expect(
      await status(
        inTx(asOwner(), (t) =>
          createWebhook(t, {
            url: "https://hermes.exemplo.com.br/hub",
            events: ["task.created"],
          }),
        ),
      ),
    ).toBe(409);
  });

  it("só o dono: administração e agente recebem 403", async () => {
    const admin: UserActor = { ...h.owner_actor, role: "admin" };
    expect(
      await status(inTx(ctxFor(h, admin, "ui"), (t) => listWebhooks(t))),
    ).toBe(403);
    const agent = await agentActor(h, h.keys.todos);
    expect(
      await status(inTx(ctxFor(h, agent, "mcp"), (t) => listWebhooks(t))),
    ).toBe(403);
  });

  it("teste, entrega assinada pelo job e troca de segredo", async () => {
    const made = await inTx(asOwner(), (t) =>
      createWebhook(t, {
        url: "https://n8n.exemplo.com.br/webhook/hub",
        events: ["task.created"],
      }),
    );
    await inTx(asOwner(), (t) => sendWebhookTest(t, made.id));
    const calls: { headers: Record<string, string>; body: string }[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      calls.push({
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    await h.raw.query(
      `delete from ${S}.jobs where type = 'webhook-dispatch' and status = 'done'`,
    );
    await tick(h.db, h.ws, { encryptionKey: KEY, fetch: fakeFetch });
    const test = calls.find((c) => c.headers["Hub-Event"] === "webhook.test");
    expect(test).toBeDefined();
    // Quem recebe confere a assinatura com o segredo mostrado no cadastro.
    const expected =
      "sha256=" +
      createHmac("sha256", made.secret)
        .update(`${test!.headers["Hub-Timestamp"]}.${test!.body}`)
        .digest("hex");
    expect(test!.headers["Hub-Signature"]).toBe(expected);

    const list = await inTx(asOwner(), (t) => listWebhooks(t));
    const item = list.find((w) => w.id === made.id)!;
    expect(item).toMatchObject({ active: true, pending: 0 });
    expect(item.recent[0]).toMatchObject({
      event: "webhook.test",
      statusCode: 204,
    });
    expect(item.recent[0].deliveredAt).not.toBeNull();

    const rotated = await inTx(asOwner(), (t) =>
      rotateWebhookSecret(t, made.id),
    );
    expect(rotated.secret).not.toBe(made.secret);
    await inTx(asOwner(), (t) => setWebhookActive(t, made.id, false));
    expect(
      await status(inTx(asOwner(), (t) => sendWebhookTest(t, made.id))),
    ).toBe(422);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log
          where entity_id = $1 and action in ('webhook.created', 'webhook.secret_rotated', 'webhook.paused')`,
        [made.id],
      ),
    ).toBe(3);
  });
});
