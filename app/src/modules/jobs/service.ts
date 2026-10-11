import { decryptSecret, signWebhook, signWebhookBody } from "@/lib/crypto";
import type { SystemActor } from "@/lib/db/actor";
import type { Db } from "@/lib/db/types";
import {
  inTx,
  json,
  many,
  maybeOne,
  S,
  type Ctx,
  type TxCtx,
} from "@/modules/context";
import { refreshAllHealth } from "@/modules/health/service";
import { businessDaysBetween } from "@/modules/health/rule";
import { refreshAgentSpend, type LlmDeps } from "@/lib/llm";
import { attempt } from "@/modules/attempt";
import { REWRITE_JOB, rewriteForClient } from "@/modules/client-text/writer";
import { notifyOwners, notifyProfile } from "@/modules/notifications";
import { noteJobFailed, watchDenials } from "@/modules/ops/alerts";
import { applyRetention } from "@/modules/privacy/service";
import { reopenTask } from "@/modules/tasks/service";

/**
 * Fila de jobs no Postgres (PRD ADR 7: sem Redis na v1). O systemd timer da VPS chama
 * POST /api/internal/cron/tick a cada 5 minutos; o tick agenda os jobs periódicos e roda
 * os que estão na vez, com FOR UPDATE SKIP LOCKED para nunca rodar o mesmo job duas vezes.
 */

export type JobType =
  | "health-rollup"
  | "approval-aging"
  | "evidence-check"
  | "agent-spend"
  | "webhook-dispatch"
  | "idempotency-cleanup"
  | "ops-watch"
  | "retention"
  | typeof REWRITE_JOB;

/** Jobs periódicos e o intervalo mínimo entre duas execuções. */
export const PERIODIC_JOBS: { type: JobType; everyMinutes: number }[] = [
  { type: "health-rollup", everyMinutes: 15 },
  { type: "approval-aging", everyMinutes: 60 },
  { type: "evidence-check", everyMinutes: 60 },
  { type: "agent-spend", everyMinutes: 60 },
  { type: "webhook-dispatch", everyMinutes: 1 },
  { type: "idempotency-cleanup", everyMinutes: 60 },
  { type: "ops-watch", everyMinutes: 15 },
  { type: "retention", everyMinutes: 24 * 60 },
];

export type JobDeps = {
  now?: () => Date;
  fetch?: typeof fetch;
  encryptionKey?: Buffer | null;
  /** IA dos jobs que escrevem (nos testes, o modelo simulado). */
  llm?: LlmDeps;
};

export type JobOutcome = {
  id: string;
  type: string;
  status: "done" | "retry" | "failed";
  result?: unknown;
  error?: string;
};

const MAX_ATTEMPTS = 5;
const MAX_WEBHOOK_ATTEMPTS = 8;

export function systemActor(workspaceId: string): SystemActor {
  return {
    type: "system",
    id: null,
    scope: "internal",
    workspaceId,
    name: "Hub",
  };
}

/** Agenda os periódicos que não rodaram no intervalo e ainda não estão na fila. */
export async function enqueuePeriodic(t: TxCtx): Promise<string[]> {
  const enqueued: string[] = [];
  for (const job of PERIODIC_JOBS) {
    const row = await maybeOne<{ id: string }>(
      t,
      `insert into ${S}.jobs (workspace_id, type, payload, run_at, dedupe_key)
       select $1, $2, '{}'::jsonb, now(), $2
        where not exists (
          select 1 from ${S}.jobs
           where workspace_id = $1 and type = $2 and status = 'done'
             and updated_at > now() - make_interval(mins => $3))
       on conflict (workspace_id, dedupe_key)
         where dedupe_key is not null and status in ('queued', 'running')
       do nothing
       returning id`,
      [t.actor.workspaceId, job.type, job.everyMinutes],
    );
    if (row) enqueued.push(job.type);
  }
  return enqueued;
}

async function runJob(
  ctx: Ctx,
  job: { id: string; type: string; payload: Record<string, unknown> },
  deps: JobDeps,
): Promise<unknown> {
  const now = deps.now?.() ?? new Date();
  switch (job.type as JobType) {
    case "health-rollup":
      return inTx(ctx, (t) => refreshAllHealth(t, now));
    case "approval-aging":
      return inTx(ctx, (t) => approvalAging(t, now));
    case "evidence-check":
      return inTx(ctx, (t) => evidenceCheck(t));
    case "agent-spend":
      return inTx(ctx, async (t) => ({ agents: await refreshAgentSpend(t) }));
    case "idempotency-cleanup":
      return inTx(ctx, async (t) => {
        const rows = await many(
          t,
          `delete from ${S}.idempotency_keys where expires_at < now() returning key`,
        );
        return { deleted: rows.length };
      });
    case "webhook-dispatch":
      return dispatchWebhooks(ctx, deps);
    case "ops-watch":
      return inTx(ctx, (t) => watchDenials(t));
    case "retention":
      // LGPD: apaga os registros operacionais antigos (prazos em docs/privacidade.md).
      return inTx(ctx, (t) => applyRetention(t));
    case REWRITE_JOB:
      // RC-12: a IA fica fora de transação; sem Redator ligado, o pedido segue como está.
      return rewriteForClient(
        ctx,
        String(job.payload.approval_id ?? ""),
        deps.llm,
      );
    default:
      throw new Error(`Tipo de job desconhecido: ${job.type}`);
  }
}

/**
 * Conclusão sem evidência em projeto que exige evidência (base determinística do Guardião
 * da Qualidade, QA-04): a tarefa é reaberta, com o motivo no comentário, e quem cuida dela
 * recebe aviso (a pessoa responsável; se for de agente ou de ninguém, o dono).
 */
async function evidenceCheck(t: TxCtx): Promise<{ reopened: string[] }> {
  const rows = await many<{
    code: string;
    title: string;
    project_code: string;
    assignee_type: string | null;
    assignee_id: string | null;
  }>(
    t,
    `select k.code, k.title, p.code as project_code, k.assignee_type, k.assignee_id
       from ${S}.tasks k join ${S}.projects p on p.id = k.project_id
      where k.status_category = 'done' and k.archived_at is null
        and p.require_evidence and p.archived_at is null
        and coalesce(btrim(k.done_evidence), '') = ''
      order by k.code`,
  );
  const reopened: string[] = [];
  for (const row of rows) {
    const done = await attempt(t, () =>
      reopenTask(t, row.code, {
        reason:
          "concluída sem evidência num projeto que exige evidência. Conclua de novo com a evidência (SHA, URL, arquivo ou teste).",
      }),
    );
    if (!done.ok) continue;
    reopened.push(row.code);
    const entity = { type: "task", id: done.value.id };
    const payload = {
      task_code: row.code,
      project_code: row.project_code,
      title: row.title,
    };
    if (row.assignee_type === "user" && row.assignee_id) {
      await notifyProfile(t, row.assignee_id, "task.reopened", entity, payload);
    } else {
      await notifyOwners(t, "task.reopened", entity, payload);
    }
  }
  return { reopened };
}

/** Aprovação parada há mais de 3 dias úteis: avisa o owner, no máximo uma vez por dia. */
async function approvalAging(
  t: TxCtx,
  now: Date,
): Promise<{ notified: number }> {
  const pending = await many<{
    id: string;
    title: string;
    created_at: Date | string;
  }>(
    t,
    `select a.id, a.title, a.created_at from ${S}.approvals a
      where a.status = 'pending'
        and not exists (
          select 1 from ${S}.notifications n
           where n.type = 'approval.aging' and n.entity_id = a.id
             and n.created_at > now() - interval '24 hours')`,
  );
  let notified = 0;
  for (const a of pending) {
    const days = businessDaysBetween(new Date(a.created_at), now);
    if (days <= 3) continue;
    await notifyOwners(
      t,
      "approval.aging",
      { type: "approval", id: a.id },
      {
        title: a.title,
        business_days: days,
      },
    );
    notified += 1;
  }
  return { notified };
}

/** Entrega os eventos pendentes, assinados com HMAC; falhas voltam com espera crescente. */
async function dispatchWebhooks(
  ctx: Ctx,
  deps: JobDeps,
): Promise<{ delivered: number; failed: number; skipped: number }> {
  const doFetch = deps.fetch ?? fetch;
  const deliveries = await inTx(ctx, (t) =>
    many<{
      id: string;
      event: string;
      payload: unknown;
      attempts: number;
      url: string;
      secret_ciphertext: string;
    }>(
      t,
      `select d.id, d.event, d.payload, d.attempts, w.url, w.secret_ciphertext
         from ${S}.webhook_deliveries d
         join ${S}.webhooks w on w.id = d.webhook_id
        where d.delivered_at is null and d.attempts < $1
          and coalesce(d.next_attempt_at, now()) <= now() and w.active
        order by d.created_at limit 50`,
      [MAX_WEBHOOK_ATTEMPTS],
    ),
  );
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  for (const d of deliveries) {
    if (!deps.encryptionKey) {
      skipped += 1;
      continue;
    }
    const body = JSON.stringify(d.payload);
    const timestamp = String(
      Math.floor((deps.now?.() ?? new Date()).getTime() / 1000),
    );
    let status: number | null = null;
    let error: string | null = null;
    try {
      const secret = decryptSecret(d.secret_ciphertext, deps.encryptionKey);
      const response = await doFetch(d.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "HubDeGestao-Webhook/1",
          "Hub-Event": d.event,
          "Hub-Delivery": d.id,
          "Hub-Timestamp": timestamp,
          "Hub-Signature": signWebhook(secret, timestamp, body),
          "X-Hub-Signature-256": signWebhookBody(secret, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
      if (!response.ok) error = `HTTP ${response.status}`;
    } catch (err) {
      error =
        err instanceof Error ? err.message.slice(0, 300) : "falha de rede";
    }
    await inTx(ctx, (t) =>
      t.tx.query(
        error
          ? `update ${S}.webhook_deliveries
                set attempts = attempts + 1, status_code = $2, last_error = $3,
                    next_attempt_at = now() + make_interval(mins => power(2, attempts)::int)
              where id = $1`
          : `update ${S}.webhook_deliveries
                set attempts = attempts + 1, status_code = $2, last_error = null, delivered_at = now()
              where id = $1`,
        error ? [d.id, status, error] : [d.id, status],
      ),
    );
    if (error) failed += 1;
    else delivered += 1;
  }
  return { delivered, failed, skipped };
}

/**
 * Um ciclo do relógio: libera jobs travados, agenda os periódicos e roda os que estão na
 * vez. Cada job roda na própria transação; falha volta para a fila com espera crescente.
 */
export async function tick(
  db: Db,
  workspaceId: string,
  deps: JobDeps = {},
  options: { maxJobs?: number; requestId?: string } = {},
): Promise<{ enqueued: string[]; ran: JobOutcome[] }> {
  const ctx: Ctx = {
    db,
    actor: systemActor(workspaceId),
    source: "cron",
    requestId: options.requestId ?? `cron-${Date.now()}`,
  };
  const enqueued = await inTx(ctx, async (t) => {
    await t.tx.query(
      `update ${S}.jobs set status = 'queued', locked_at = null
        where status = 'running' and locked_at < now() - interval '15 minutes'`,
    );
    return enqueuePeriodic(t);
  });

  const claimed = await inTx(ctx, (t) =>
    many<{
      id: string;
      type: string;
      payload: Record<string, unknown>;
      attempts: number;
    }>(
      t,
      `update ${S}.jobs set status = 'running', locked_at = now(), attempts = attempts + 1
        where id in (
          select id from ${S}.jobs
           where status = 'queued' and run_at <= now()
           order by run_at
           limit $1
           for update skip locked)
       returning id, type, payload, attempts`,
      [options.maxJobs ?? 20],
    ),
  );

  const ran: JobOutcome[] = [];
  for (const job of claimed) {
    try {
      const result = await runJob(ctx, job, deps);
      await inTx(ctx, (t) =>
        t.tx.query(
          `update ${S}.jobs set status = 'done', locked_at = null, last_error = null,
                  payload = payload || jsonb_build_object('last_result', $2::jsonb)
            where id = $1`,
          [job.id, json(result ?? null)],
        ),
      );
      ran.push({ id: job.id, type: job.type, status: "done", result });
    } catch (err) {
      const message =
        err instanceof Error ? err.message.slice(0, 500) : "erro desconhecido";
      const retry = job.attempts < MAX_ATTEMPTS;
      await inTx(ctx, async (t) => {
        await t.tx.query(
          `update ${S}.jobs
              set status = $2, locked_at = null, last_error = $3,
                  run_at = now() + make_interval(mins => power(2, attempts)::int)
            where id = $1`,
          [job.id, retry ? "queued" : "failed", message],
        );
        // Falhou de vez: o dono e os webhooks ficam sabendo (M8, alertas de operação).
        if (!retry) await noteJobFailed(t, job, message);
      });
      ran.push({
        id: job.id,
        type: job.type,
        status: retry ? "retry" : "failed",
        error: message,
      });
    }
  }
  return { enqueued, ran };
}
