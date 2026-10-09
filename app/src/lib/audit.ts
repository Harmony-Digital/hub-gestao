import { json, S, type TxCtx } from "@/modules/context";

/**
 * Registro de atividades (append-only): toda mutação grava quem fez, por onde, o que
 * mudou e em qual pedido (AGENTS.md §7.6). Roda na mesma transação da mudança.
 */
export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  before?: unknown;
  after?: unknown;
};

export async function audit(t: TxCtx, entry: AuditEntry): Promise<void> {
  await t.tx.query(
    `insert into ${S}.activity_log
       (workspace_id, actor_type, actor_id, acting_role, source, action, entity_type,
        entity_id, project_id, before, after, request_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)`,
    [
      t.actor.workspaceId,
      t.actor.type,
      t.actor.id,
      t.actor.actingRole ?? null,
      t.source,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.projectId ?? null,
      json(entry.before ?? null),
      json(entry.after ?? null),
      t.requestId,
    ],
  );
}

/** Só os campos que mudaram, para o antes/depois de uma atualização. */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  keys: readonly string[],
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key] ?? null;
      a[key] = after[key] ?? null;
    }
  }
  return { before: b, after: a };
}
