import { z } from "zod";
import { audit } from "@/lib/audit";
import { scrub } from "@/lib/log-safe";
import { JOB_TYPE } from "@/lib/labels";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { emitEvent } from "@/modules/events";
import { notifyOwners } from "@/modules/notifications";

/**
 * Alertas de operação (M8): viram aviso na caixa de entrada do dono e evento de webhook
 * (que o Hermes leva ao Telegram). Cada um sai uma vez só por motivo, para a falha
 * repetida não virar enxurrada. O relógio parado não está aqui: com ele parado, nem os
 * webhooks saem; ele aparece na saúde (/api/health) e na Sala de Controle.
 */

/** Recusas da mesma chave de agente numa hora que viram alerta. */
export const DENIALS_ALERT = 5;

type DenialGroup = {
  agent_id: string | null;
  agent_name: string | null;
  key_prefix: string | null;
  n: number;
  s401: number;
  s403: number;
  s423: number;
  last_reason: string;
};

/**
 * Autorização recorrente: DENIALS_ALERT ou mais recusas da mesma chave de agente na
 * última hora. No máximo um alerta por agente (ou chave) por dia.
 */
export async function watchDenials(t: TxCtx): Promise<{ alerted: string[] }> {
  const groups = await many<DenialGroup>(
    t,
    `select d.agent_id, ag.name as agent_name, min(d.key_prefix) as key_prefix,
            count(*)::int as n,
            count(*) filter (where d.status = 401)::int as s401,
            count(*) filter (where d.status = 403)::int as s403,
            count(*) filter (where d.status = 423)::int as s423,
            (array_agg(d.reason order by d.id desc))[1] as last_reason
       from ${S}.agent_denials d
       left join ${S}.agents ag on ag.id = d.agent_id
      where d.created_at > now() - interval '1 hour'
      group by d.agent_id, ag.name, case when d.agent_id is null then d.key_prefix end
     having count(*) >= $1`,
    [DENIALS_ALERT],
  );
  const alerted: string[] = [];
  for (const g of groups) {
    const who = g.agent_id ?? `chave:${g.key_prefix ?? "desconhecida"}`;
    const already = await maybeOne(
      t,
      `select 1 from ${S}.activity_log
        where action = 'agent.denials_recurring' and after->>'who' = $1
          and created_at > now() - interval '24 hours'
        limit 1`,
      [who],
    );
    if (already) continue;
    const data = {
      who,
      agent: g.agent_id ? { id: g.agent_id, name: g.agent_name } : null,
      key_prefix: g.key_prefix,
      count: g.n,
      by_status: { "401": g.s401, "403": g.s403, "423": g.s423 },
      last_reason: scrub(g.last_reason).slice(0, 200),
      window_minutes: 60,
    };
    await audit(t, {
      action: "agent.denials_recurring",
      entityType: "agent",
      entityId: g.agent_id,
      after: data,
    });
    await emitEvent(t, "agent.denials_recurring", data);
    await notifyOwners(
      t,
      "agent.denials_recurring",
      { type: "agent", id: g.agent_id ?? t.actor.workspaceId },
      {
        agent_name: g.agent_name ?? g.key_prefix ?? "Chave desconhecida",
        count: g.n,
        detail: data.last_reason,
      },
    );
    alerted.push(who);
  }
  return { alerted };
}

/** Job que esgotou as tentativas: um alerta por job (quem chama já gravou a falha). */
export async function noteJobFailed(
  t: TxCtx,
  job: { id: string; type: string; attempts: number },
  error: string,
): Promise<void> {
  const data = {
    job_id: job.id,
    type: job.type,
    label: JOB_TYPE[job.type] ?? job.type,
    attempts: job.attempts,
    error: scrub(error).slice(0, 200),
  };
  await audit(t, {
    action: "system.job_failed",
    entityType: "job",
    entityId: job.id,
    after: data,
  });
  await emitEvent(t, "system.job_failed", data);
  await notifyOwners(
    t,
    "system.job_failed",
    { type: "job", id: job.id },
    { label: data.label, attempts: job.attempts, detail: data.error },
  );
}

export const DeployAlertInput = z.strictObject({
  sha: z.string().regex(/^[0-9a-f]{7,40}$/, "SHA do commit."),
  run_url: z
    .url()
    .regex(
      /^https:\/\/github\.com\/Harmony-Digital\/hub-gestao\/actions\/runs\/\d+(\/.*)?$/,
      "Endereço da execução no GitHub Actions deste repositório.",
    ),
});
export type DeployAlertInput = z.infer<typeof DeployAlertInput>;

/**
 * Publicação que falhou (aviso do GitHub Actions): a versão anterior continua no ar. Um
 * alerta por commit. Devolve se o alerta é novo.
 */
export async function noteDeployFailed(
  t: TxCtx,
  input: DeployAlertInput,
): Promise<boolean> {
  const already = await maybeOne(
    t,
    `select 1 from ${S}.activity_log
      where action = 'system.deploy_failed' and after->>'sha' = $1
      limit 1`,
    [input.sha],
  );
  if (already) return false;
  const data = { sha: input.sha, run_url: input.run_url };
  await audit(t, {
    action: "system.deploy_failed",
    entityType: "workspace",
    entityId: t.actor.workspaceId,
    after: data,
  });
  await emitEvent(t, "system.deploy_failed", data);
  await notifyOwners(
    t,
    "system.deploy_failed",
    { type: "workspace", id: t.actor.workspaceId },
    { sha: input.sha, detail: `Commit ${input.sha.slice(0, 7)}` },
  );
  return true;
}
