import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setDbForTests } from "@/lib/db";
import { inTx } from "@/modules/context";
import { createTask } from "@/modules/tasks/service";
import { count, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { POST } from "./route";

const SECRET = "segredo-do-webhook-de-teste-com-mais-de-32";
let h: TestHub;

beforeAll(async () => {
  h = await openTestHub();
  setDbForTests(h.db);
});
afterAll(async () => {
  setDbForTests(null);
  await h.db.close();
});
afterEach(() => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
});

function request(
  event: string,
  payload: unknown,
  signature: string | null = null,
) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": event,
    "x-github-delivery": "entrega-de-teste",
  };
  headers["x-hub-signature-256"] =
    signature ??
    `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
  return new Request("http://hub.test/api/internal/webhooks/github", {
    method: "POST",
    headers,
    body,
  });
}

describe("webhook do GitHub", () => {
  it("sem o segredo configurado, recusa tudo", async () => {
    const res = await POST(request("ping", { zen: "oi" }));
    expect(res.status).toBe(500);
    expect((await res.json()).detail).toMatch(/GITHUB_WEBHOOK_SECRET/);
  });

  it("assinatura errada: 401; ping certo: 200", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    const bad = await POST(
      request("ping", { zen: "oi" }, "sha256=" + "0".repeat(64)),
    );
    expect(bad.status).toBe(401);
    const ping = await POST(request("ping", { zen: "oi" }));
    expect(ping.status).toBe(200);
    expect(await ping.json()).toEqual({ ok: true, event: "ping" });
  });

  it("push assinado comenta na tarefa citada", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    const task = await inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
      createTask(t, { project: "VIT", title: "Citada pelo webhook" }),
    );
    const res = await POST(
      request("push", {
        ref: "refs/heads/main",
        repository: {
          full_name: "Harmony-Digital/exemplo",
          default_branch: "main",
        },
        commits: [
          {
            id: "0123456789ab",
            message: `Ajuste (${task.code})`,
            url: "https://github.com/Harmony-Digital/exemplo/commit/0123456789ab",
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ event: "push", comments: 1 });
    expect(
      await count(
        h,
        `select count(*)::int as n from proj_hub_gestao.comments c
           join proj_hub_gestao.tasks k on k.id = c.entity_id
          where k.code = $1 and c.body_md like 'Commit 0123456 em Harmony-Digital/exemplo@main:%'`,
        [task.code],
      ),
    ).toBe(1);
  });
});
