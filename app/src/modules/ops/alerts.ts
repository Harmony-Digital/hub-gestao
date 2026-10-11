import { z } from "zod";
import { audit } from "@/lib/audit";
import { scrub } from "@/lib/log-safe";
import { JOB_TYPE } from "@/lib/labels";
import { iso } from "@/modules/common";
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

/** Backups que avisam o Hub quando dão certo: o dump diário na VPS e a cópia no Drive. */
export const BACKUP_KINDS = ["local", "offsite"] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/** Horas sem registro de backup que dão alerta (o diário roda a cada 24 horas). */
export const BACKUP_STALE_HOURS = 30;

export const BACKUP_LABEL: Record<BackupKind, string> = {
  local: "O backup diário do banco",
  offsite: "A cópia do backup no Google Drive",
};

export const BackupReportInput = z.strictObject({
  kind: z.enum(BACKUP_KINDS),
  file: z
    .string()
    .regex(/^hub-\d{8}T\d{6}Z\.dump(\.gpg)?$/, "Nome do arquivo do backup."),
  bytes: z.number().int().min(1).max(100_000_000_000),
});
export type BackupReportInput = z.infer<typeof BackupReportInput>;

/**
 * Backup que deu certo: o script da VPS avisa pelo próprio contêiner, com o CRON_SECRET
 * (`app/scripts/backup-report.mjs`). Fica no histórico do workspace.
 */
export async function noteBackupDone(
  t: TxCtx,
  input: BackupReportInput,
): Promise<void> {
  await audit(t, {
    action: "backup.done",
    entityType: "workspace",
    entityId: t.actor.workspaceId,
    after: { kind: input.kind, file: input.file, bytes: input.bytes },
  });
}

/**
 * Backup parado: um tipo que já avisou sucesso alguma vez e está sem aviso há mais de
 * BACKUP_STALE_HOURS. Um alerta por tipo por dia. Antes do primeiro aviso (a cópia no
 * Drive ainda não ligada, por exemplo), não alerta.
 */
export async function watchBackups(t: TxCtx): Promise<{ stale: BackupKind[] }> {
  const rows = await many<{
    kind: string;
    last: Date | string;
    hours: number;
  }>(
    t,
    `select after->>'kind' as kind, max(created_at) as last,
            floor(extract(epoch from now() - max(created_at)) / 3600)::int as hours
       from ${S}.activity_log
      where entity_type = 'workspace' and entity_id = $1 and action = 'backup.done'
      group by after->>'kind'`,
    [t.actor.workspaceId],
  );
  const stale: BackupKind[] = [];
  for (const r of rows) {
    const kind = BACKUP_KINDS.find((k) => k === r.kind);
    if (!kind || r.hours < BACKUP_STALE_HOURS) continue;
    const already = await maybeOne(
      t,
      `select 1 from ${S}.activity_log
        where entity_type = 'workspace' and entity_id = $1
          and action = 'system.backup_stale' and after->>'kind' = $2
          and created_at > now() - interval '24 hours'
        limit 1`,
      [t.actor.workspaceId, kind],
    );
    if (already) continue;
    const data = {
      kind,
      label: BACKUP_LABEL[kind],
      last_at: iso(r.last),
      hours: r.hours,
    };
    await audit(t, {
      action: "system.backup_stale",
      entityType: "workspace",
      entityId: t.actor.workspaceId,
      after: data,
    });
    await emitEvent(t, "system.backup_stale", data);
    await notifyOwners(
      t,
      "system.backup_stale",
      { type: "workspace", id: t.actor.workspaceId },
      {
        label: data.label,
        hours: r.hours,
        detail: "Ver docs/operacao.md, Backup e restauração.",
      },
    );
    stale.push(kind);
  }
  return { stale };
}
