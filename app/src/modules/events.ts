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
  | "agent.budget_exceeded";

export async function emitEvent(
  t: TxCtx,
  event: HubEvent,
  data: Record<string, unknown>,
): Promise<void> {
  await t.tx.query(
    `insert into ${S}.webhook_deliveries (workspace_id, webhook_id, event, payload, next_attempt_at)
     select w.workspace_id, w.id, $1, $2::jsonb, now()
       from ${S}.webhooks w
      where w.active and ($1 = any(w.events) or '*' = any(w.events))`,
    [
      event,
      json({
        event,
        occurred_at: new Date().toISOString(),
        request_id: t.requestId,
        actor: { type: t.actor.type, id: t.actor.id, name: t.actor.name },
        data,
      }),
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
