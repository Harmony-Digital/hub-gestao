import { json, S, type TxCtx } from "@/modules/context";

/**
 * Eventos de saída (PRD §8.6). Cada evento vira uma entrega pendente para os webhooks
 * ativos que o assinam; o job webhook-dispatch envia com assinatura HMAC e retentativas.
 */
export type HubEvent =
  | "task.created"
  | "task.updated"
  | "task.completed"
  | "task.blocked"
  | "workstream.updated"
  | "milestone.status_changed"
  | "approval.requested"
  | "approval.decided"
  | "report.published"
  | "project.health_changed"
  | "agent.budget_exceeded"
  | "agent.denials_recurring"
  | "system.job_failed"
  | "system.deploy_failed"
  | "system.backup_stale"
  | "client.commented"
  | "client.receipt_confirmed";

/** Alertas de operação: saem na hora, mesmo no horário de silêncio. */
export function urgentEvent(event: string): boolean {
  return event.startsWith("system.");
}

/**
 * Põe o evento na fila de cada webhook ativo que o assina. Webhook com o horário de
 * silêncio (RF-33, migração 0024) recebe o que acontece das 23h às 8h, no fuso do
 * workspace, só às 8h; os alertas de operação (system.*) saem na hora.
 */
export async function emitEvent(
  t: TxCtx,
  event: HubEvent,
  data: Record<string, unknown>,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await t.tx.query(
    `insert into ${S}.webhook_deliveries (workspace_id, webhook_id, event, payload, next_attempt_at)
     select w.workspace_id, w.id, $1, $2::jsonb,
            case
              when w.quiet_hours and $4::boolean
               and (extract(hour from $3::timestamptz at time zone ws.timezone) >= 23
                    or extract(hour from $3::timestamptz at time zone ws.timezone) < 8)
              then (date_trunc('day', $3::timestamptz at time zone ws.timezone)
                    + case when extract(hour from $3::timestamptz at time zone ws.timezone) >= 23
                           then interval '1 day 8 hours' else interval '8 hours' end)
                   at time zone ws.timezone
              else $3::timestamptz
            end
       from ${S}.webhooks w
       join ${S}.workspaces ws on ws.id = w.workspace_id
      where w.active and ($1 = any(w.events) or '*' = any(w.events))`,
    [
      event,
      json({
        event,
        occurred_at: now.toISOString(),
        request_id: t.requestId,
        actor: { type: t.actor.type, id: t.actor.id, name: t.actor.name },
        data,
      }),
      now,
      !urgentEvent(event),
    ],
  );
}

/** Recalcula o progresso de frentes, marcos e do projeto (regra em SQL, testada). */
export async function recomputeRollup(
  t: TxCtx,
  projectId: string,
): Promise<void> {
  await t.tx.query(`select ${S}.recompute_project_rollup($1)`, [projectId]);
}
