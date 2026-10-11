import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { toHubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { systemActor } from "@/modules/jobs/service";
import { count, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { retentionSettings, setRetention } from "./retention";
import { effectiveRetention, RETENTION } from "./retention-rules";
import { applyRetention } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
let admin: UserActor;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asHub = () => ctxFor(h, systemActor(h.ws), "cron");
const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 0,
    (e: unknown) => toHubError(e).status,
  );
const defaults = Object.fromEntries(RETENTION.map((r) => [r.key, r.default]));

beforeAll(async () => {
  h = await openTestHub();
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('bia.retencao@exemplo.com', 'Bia') returning id`,
    )
  ).rows[0];
  await h.raw.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'admin')`,
    [h.ws, profile.id],
  );
  admin = {
    type: "user",
    id: profile.id,
    scope: "internal",
    role: "admin",
    workspaceId: h.ws,
    name: "Bia",
  };
});

afterAll(async () => {
  await h.db.close();
});

describe("prazos de retenção (PRD §12)", () => {
  it("sem nada guardado vale o padrão; fora da faixa vira o limite", () => {
    expect(effectiveRetention(undefined)).toEqual(defaults);
    expect(
      effectiveRetention({
        agent_denials: 5,
        agent_runs: "5000",
        jobs_done: "x",
      }),
    ).toMatchObject({ agent_denials: 30, agent_runs: 1095, jobs_done: 30 });
  });

  it("só o dono muda; a administração vê; valor fora da faixa é recusado", async () => {
    expect(
      await inTx(ctxFor(h, admin, "ui"), (t) => retentionSettings(t)),
    ).toEqual(defaults);
    const next = { ...defaults, agent_denials: 40, agent_runs: 120 } as never;
    expect(
      await status(inTx(ctxFor(h, admin, "ui"), (t) => setRetention(t, next))),
    ).toBe(403);
    expect(
      await status(
        inTx(asOwner(), (t) =>
          setRetention(t, { ...defaults, jobs_done: 3 } as never),
        ),
      ),
    ).toBe(422);
    await inTx(asOwner(), (t) => setRetention(t, next));
    expect(await inTx(asOwner(), (t) => retentionSettings(t))).toMatchObject({
      agent_denials: 40,
      agent_runs: 120,
    });
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log where action = 'workspace.retention_changed'`,
      ),
    ).toBe(1);
  });

  it("a limpeza diária usa os prazos guardados, também nas chamadas de IA", async () => {
    const old = (days: number) => `now() - interval '${days} days'`;
    await h.raw.query(
      `insert into ${S}.agent_denials (workspace_id, agent_id, source, status, action, reason, created_at)
       values ($1, $2, 'api', 403, 'retencao-50', 'x', ${old(50)}),
              ($1, $2, 'api', 403, 'retencao-20', 'x', ${old(20)})`,
      [h.ws, h.agents.kratos],
    );
    await h.raw.query(
      `insert into ${S}.agent_runs (workspace_id, agent_id, source, summary, started_at)
       values ($1, $2, 'teste', 'retencao-200', ${old(200)}),
              ($1, $2, 'teste', 'retencao-100', ${old(100)})`,
      [h.ws, h.agents.kratos],
    );
    const removed = await inTx(asHub(), (t) => applyRetention(t));
    expect(removed).toMatchObject({ agent_denials: 1, agent_runs: 1 });
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.agent_denials where action like 'retencao-%'`,
      ),
    ).toBe(1);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.agent_runs where summary = 'retencao-100'`,
      ),
    ).toBe(1);
    // Valor guardado à mão fora da faixa: a função usa o limite (30 dias, não 5).
    await h.raw.query(
      `update ${S}.workspaces set settings = jsonb_set(settings, '{retention,agent_denials}', '5') where id = $1`,
      [h.ws],
    );
    await inTx(asHub(), (t) => applyRetention(t));
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.agent_denials where action = 'retencao-20'`,
      ),
    ).toBe(1);
  });
});
