import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { forbidden, unprocessable } from "@/lib/errors";
import { json, maybeOne, S, type TxCtx } from "@/modules/context";
import {
  effectiveRetention,
  RETENTION,
  type RetentionKey,
  type RetentionValues,
} from "./retention-rules";

export {
  effectiveRetention,
  RETENTION,
  type RetentionKey,
  type RetentionValues,
};

/**
 * Prazos de retenção dos registros operacionais (PRD §12; `docs/privacidade.md`), em
 * dias, guardados em `workspaces.settings.retention` e lidos pela função
 * `apply_retention` (migração 0027), que roda uma vez por dia. O padrão e os limites
 * daqui são os mesmos da função; o histórico (activity_log) não entra.
 */

/** Os prazos em vigor no workspace (dono e administração veem). */
export async function retentionSettings(t: TxCtx): Promise<RetentionValues> {
  authorize(t.actor, "workspace.admin");
  const row = await maybeOne<{ retention: unknown }>(
    t,
    `select settings -> 'retention' as retention from ${S}.workspaces where id = $1`,
    [t.actor.workspaceId],
  );
  return effectiveRetention(row?.retention);
}

export const RetentionInput = z.strictObject(
  Object.fromEntries(
    RETENTION.map((r) => [
      r.key,
      z
        .number()
        .int()
        .min(r.min, `${r.label}: de ${r.min} a ${r.max} dias.`)
        .max(r.max, `${r.label}: de ${r.min} a ${r.max} dias.`),
    ]),
  ) as Record<RetentionKey, z.ZodNumber>,
);

/** Troca os prazos (só o dono): valem a partir da próxima limpeza diária. */
export async function setRetention(
  t: TxCtx,
  input: RetentionValues,
): Promise<void> {
  authorize(t.actor, "workspace.admin");
  if (
    t.actor.type !== "user" ||
    t.actor.scope !== "internal" ||
    t.actor.role !== "owner"
  ) {
    throw forbidden("Só o dono muda os prazos de retenção.");
  }
  const parsed = RetentionInput.safeParse(input);
  if (!parsed.success) {
    throw unprocessable(parsed.error.issues[0]?.message ?? "Prazo inválido.");
  }
  const before = await retentionSettings(t);
  const after = parsed.data as RetentionValues;
  if (RETENTION.every((r) => before[r.key] === after[r.key])) return;
  await t.tx.query(
    `update ${S}.workspaces
        set settings = jsonb_set(settings, '{retention}', $2::jsonb, true)
      where id = $1`,
    [t.actor.workspaceId, json(after)],
  );
  await audit(t, {
    action: "workspace.retention_changed",
    entityType: "workspace",
    entityId: t.actor.workspaceId,
    before,
    after,
  });
}
