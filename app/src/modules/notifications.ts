import { json, S, type TxCtx } from "@/modules/context";

/** Avisa os donos do workspace na caixa de entrada do Hub. */
export async function notifyOwners(
  t: TxCtx,
  type: string,
  entity: { type: string; id: string },
  payload: Record<string, unknown>,
): Promise<void> {
  await t.tx.query(
    `insert into ${S}.notifications (workspace_id, profile_id, type, entity_type, entity_id, payload)
     select m.workspace_id, m.profile_id, $1, $2, $3, $4::jsonb
       from ${S}.memberships m
      where m.role = 'owner' and m.status = 'active'`,
    [type, entity.type, entity.id, json(payload)],
  );
}

/** Avisa uma pessoa específica. */
export async function notifyProfile(
  t: TxCtx,
  profileId: string,
  type: string,
  entity: { type: string; id: string },
  payload: Record<string, unknown>,
): Promise<void> {
  await t.tx.query(
    `insert into ${S}.notifications (workspace_id, profile_id, type, entity_type, entity_id, payload)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      t.actor.workspaceId,
      profileId,
      type,
      entity.type,
      entity.id,
      json(payload),
    ],
  );
}
