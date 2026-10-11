import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDbForTests } from "@/lib/db";
import { POST as deployAlert } from "@/app/api/internal/alerts/deploy/route";
import { POST as backupReport } from "@/app/api/internal/backups/report/route";
import { inTx } from "@/modules/context";
import { systemActor, tick } from "@/modules/jobs/service";
import { createWebhook } from "@/modules/webhooks/service";
import { count, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import {
  BACKUP_STALE_HOURS,
  BackupReportInput,
  DENIALS_ALERT,
  DeployAlertInput,
  noteBackupDone,
  noteDeployFailed,
  watchBackups,
  watchDenials,
} from "./alerts";

const S = "proj_hub_gestao";
const SECRET = "segredo-do-aviso-de-publicacao-de-teste-0123456789";
let h: TestHub;
const asHub = () => ctxFor(h, systemActor(h.ws), "cron");

beforeAll(async () => {
  process.env.HUB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  h = await openTestHub();
  setDbForTests(h.db);
  await inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
    createWebhook(t, {
      url: "https://hermes.exemplo.com.br/hub",
      events: [
        "agent.denials_recurring",
        "system.job_failed",
        "system.deploy_failed",
        "system.backup_stale",
      ],
    }),
  );
});

afterAll(async () => {
  setDbForTests(null);
  delete process.env.HUB_ALERT_SECRET;
  delete process.env.CRON_SECRET;
  await h.db.close();
});

const deliveries = (event: string) =>
  count(
    h,
    `select count(*)::int as n from ${S}.webhook_deliveries where event = $1`,
    [event],
  );
const notices = (type: string) =>
  count(
    h,
    `select count(*)::int as n from ${S}.notifications where type = $1`,
    [type],
  );

async function deny(agentId: string, times: number) {
  for (let i = 0; i < times; i++) {
    await h.raw.query(
      `insert into ${S}.agent_denials (workspace_id, agent_id, source, status, action, reason)
       values ($1, $2, 'mcp', 403, $3, 'Sem o escopo tasks:complete.')`,
      [h.ws, agentId, `hub_complete_task ${i}`],
    );
  }
}

describe("alertas de operação", () => {
  it("recusas repetidas de um agente viram um alerta por dia", async () => {
    await deny(h.agents.pausado, DENIALS_ALERT - 1);
    expect((await inTx(asHub(), watchDenials)).alerted).toEqual([]);

    await deny(h.agents.kratos, DENIALS_ALERT);
    const first = await inTx(asHub(), watchDenials);
    expect(first.alerted).toEqual([h.agents.kratos]);
    expect(await deliveries("agent.denials_recurring")).toBe(1);
    expect(await notices("agent.denials_recurring")).toBe(1);
    const payload = await h.raw.query<{ payload: { data: unknown } }>(
      `select payload from ${S}.webhook_deliveries where event = 'agent.denials_recurring'`,
    );
    expect(payload.rows[0].payload.data).toMatchObject({
      agent: { id: h.agents.kratos, name: "Kratos" },
      count: DENIALS_ALERT,
      by_status: { "401": 0, "403": DENIALS_ALERT, "423": 0 },
    });

    // Mais recusas no mesmo dia: o alerta não se repete.
    await deny(h.agents.kratos, 2);
    expect((await inTx(asHub(), watchDenials)).alerted).toEqual([]);
    expect(await deliveries("agent.denials_recurring")).toBe(1);
  });

  it("job que esgota as tentativas avisa uma vez, pelo próprio relógio", async () => {
    await h.raw.query(
      `insert into ${S}.jobs (workspace_id, type, status, run_at, attempts)
       values ($1, 'tipo-que-nao-existe', 'queued', now() - interval '1 minute', 4)`,
      [h.ws],
    );
    const result = await tick(h.db, h.ws, {}, { maxJobs: 50 });
    expect(
      result.ran.find((r) => r.type === "tipo-que-nao-existe")?.status,
    ).toBe("failed");
    expect(await deliveries("system.job_failed")).toBe(1);
    expect(await notices("system.job_failed")).toBe(1);
  });

  it("publicação que falhou: confere o pedido e avisa uma vez por commit", async () => {
    const input = {
      sha: "a".repeat(40),
      run_url:
        "https://github.com/Harmony-Digital/hub-gestao/actions/runs/123456",
    };
    expect(await inTx(asHub(), (t) => noteDeployFailed(t, input))).toBe(true);
    expect(await inTx(asHub(), (t) => noteDeployFailed(t, input))).toBe(false);
    expect(await deliveries("system.deploy_failed")).toBe(1);
    expect(await notices("system.deploy_failed")).toBe(1);
    for (const bad of [
      { ...input, sha: "nao-e-sha" },
      { ...input, run_url: "https://exemplo.com/actions/runs/1" },
      { ...input, run_url: "https://github.com/outra/coisa/actions/runs/1" },
      { ...input, extra: 1 },
    ]) {
      expect(DeployAlertInput.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("a rota do aviso exige o segredo e fica desligada sem ele", async () => {
    const call = (secret: string | null, body: unknown) =>
      deployAlert(
        new Request("http://hub.test/api/internal/alerts/deploy", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(secret ? { authorization: `Bearer ${secret}` } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    const body = {
      sha: "b".repeat(40),
      run_url:
        "https://github.com/Harmony-Digital/hub-gestao/actions/runs/654321",
    };
    delete process.env.HUB_ALERT_SECRET;
    expect((await call(SECRET, body)).status).toBe(500);
    process.env.HUB_ALERT_SECRET = SECRET;
    expect((await call(null, body)).status).toBe(401);
    expect((await call(`${SECRET}x`, body)).status).toBe(401);
    expect((await call(SECRET, { sha: "x" })).status).toBe(400);
    const ok = await call(SECRET, body);
    expect(ok.status).toBe(202);
    expect(await ok.json()).toMatchObject({ ok: true, new: true });
    const again = await call(SECRET, body);
    expect(await again.json()).toMatchObject({ ok: true, new: false });
  });
});

describe("backups que param de dar sinal", () => {
  /** Aviso de backup antigo: o histórico só aceita inserção, e a data vem do teste. */
  const backupAt = (kind: string, hoursAgo: number) =>
    h.raw.query(
      `insert into ${S}.activity_log
         (workspace_id, actor_type, source, action, entity_type, entity_id, after, created_at)
       values ($1, 'system', 'system', 'backup.done', 'workspace', $1, $2::jsonb,
               now() - make_interval(hours => $3))`,
      [
        h.ws,
        JSON.stringify({ kind, file: "hub-20261011T060000Z.dump", bytes: 1 }),
        hoursAgo,
      ],
    );

  it("sem nenhum aviso ainda (cópia não ligada), não alerta", async () => {
    expect((await inTx(asHub(), watchBackups)).stale).toEqual([]);
  });

  it("parado há mais de 30 horas, alerta uma vez por dia por tipo", async () => {
    await backupAt("local", BACKUP_STALE_HOURS + 3);
    await backupAt("offsite", 2);
    const first = await inTx(asHub(), watchBackups);
    expect(first.stale).toEqual(["local"]);
    expect(await deliveries("system.backup_stale")).toBe(1);
    expect(await notices("system.backup_stale")).toBe(1);
    const payload = await h.raw.query<{ payload: { data: unknown } }>(
      `select payload from ${S}.webhook_deliveries where event = 'system.backup_stale'`,
    );
    expect(payload.rows[0].payload.data).toMatchObject({
      kind: "local",
      label: "O backup diário do banco",
      hours: BACKUP_STALE_HOURS + 3,
    });
    // De novo no mesmo dia: o alerta não se repete.
    expect((await inTx(asHub(), watchBackups)).stale).toEqual([]);
    // O backup voltou: o aviso mais recente vale, e nada alerta.
    await inTx(asHub(), (t) =>
      noteBackupDone(t, {
        kind: "local",
        file: "hub-20261012T060000Z.dump",
        bytes: 252925,
      }),
    );
    expect((await inTx(asHub(), watchBackups)).stale).toEqual([]);
    expect(await deliveries("system.backup_stale")).toBe(1);
  });

  it("o job ops-watch confere os backups junto com as recusas", async () => {
    await backupAt("offsite", BACKUP_STALE_HOURS + 10);
    await h.raw.query(`delete from ${S}.jobs where type = 'ops-watch'`);
    const result = await tick(h.db, h.ws, {}, { maxJobs: 50 });
    const run = result.ran.find((r) => r.type === "ops-watch");
    expect(run?.status).toBe("done");
    expect(run?.result).toMatchObject({ stale: [], alerted: [] });
    // O offsite mais recente é o de 2 horas atrás (teste anterior): não está parado.
  });

  it("a rota do aviso de backup exige o CRON_SECRET e confere o pedido", async () => {
    const SECRET_CRON = "segredo-do-relogio-de-teste-0123456789-abcdef";
    const call = (secret: string | null, body: unknown) =>
      backupReport(
        new Request("http://hub.test/api/internal/backups/report", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(secret ? { authorization: `Bearer ${secret}` } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    const body = {
      kind: "offsite",
      file: "hub-20261013T060000Z.dump.gpg",
      bytes: 253000,
    };
    delete process.env.CRON_SECRET;
    expect((await call(SECRET_CRON, body)).status).toBe(500);
    process.env.CRON_SECRET = SECRET_CRON;
    expect((await call(null, body)).status).toBe(401);
    expect((await call(`${SECRET_CRON}x`, body)).status).toBe(401);
    expect((await call(SECRET_CRON, { ...body, kind: "outro" })).status).toBe(
      400,
    );
    expect((await call(SECRET_CRON, body)).status).toBe(202);
    const row = await h.raw.query<{ after: unknown; actor_type: string }>(
      `select after, actor_type from ${S}.activity_log
        where action = 'backup.done' order by id desc limit 1`,
    );
    expect(row.rows[0]).toEqual({
      after: { kind: "offsite", file: body.file, bytes: body.bytes },
      actor_type: "system",
    });
    for (const bad of [
      { ...body, file: "../../etc/passwd" },
      { ...body, file: "hub-2026.dump" },
      { ...body, bytes: 0 },
      { ...body, bytes: 1.5 },
      { ...body, extra: 1 },
    ]) {
      expect(
        BackupReportInput.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});
