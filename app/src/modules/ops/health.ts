import { applyRuntimeRole, type SystemActor } from "@/lib/db/actor";
import type { Db } from "@/lib/db/types";
import { STALL_MINUTES, type QueueSnapshot } from "@/lib/health";
import { inTx, many, maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Operação (M8): o retrato da fila de jobs para a saúde (/api/health) e para a Sala de
 * Controle. O relógio da VPS roda a cada 5 minutos e conclui pelo menos a entrega dos
 * webhooks em toda rodada; por isso o último job concluído marca o último ciclo.
 */

export type FailedJob = {
  type: string;
  error: string | null;
  at: string;
};

export type QueueView = QueueSnapshot & { failed: FailedJob[] };

const FAILED_LIMIT = 5;

/** A fila vista por quem pede (a equipe, na Sala de Controle, ou o próprio Hub). */
export async function readQueue(t: TxCtx): Promise<QueueView> {
  const row = await maybeOne<{
    last_tick_at: Date | string | null;
    overdue: number;
    failed_24h: number;
  }>(
    t,
    `select
       (select max(updated_at) from ${S}.jobs where status = 'done') as last_tick_at,
       (select count(*)::int from ${S}.jobs
         where status = 'queued'
           and run_at < now() - make_interval(mins => $1)) as overdue,
       (select count(*)::int from ${S}.jobs
         where status = 'failed' and updated_at > now() - interval '24 hours') as failed_24h`,
    [STALL_MINUTES],
  );
  const failed = await many<{
    type: string;
    last_error: string | null;
    updated_at: Date | string;
  }>(
    t,
    `select type, last_error, updated_at from ${S}.jobs
      where status = 'failed' and updated_at > now() - interval '24 hours'
      order by updated_at desc
      limit ${FAILED_LIMIT}`,
  );
  return {
    lastTickAt: row?.last_tick_at ? new Date(row.last_tick_at) : null,
    overdue: row?.overdue ?? 0,
    failed24h: row?.failed_24h ?? 0,
    failed: failed.map((f) => ({
      type: f.type,
      // A mensagem do job é interna; na tela, só o começo.
      error: f.last_error ? f.last_error.slice(0, 160) : null,
      at: new Date(f.updated_at).toISOString(),
    })),
  };
}

/** O id do workspace pelo slug, antes de haver ator (como o relógio faz). */
export async function workspaceIdBySlug(
  db: Db,
  slug: string,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    await applyRuntimeRole(db, tx);
    const row = (
      await tx.query<{ id: string | null }>(
        `select ${S}.workspace_id_by_slug($1) as id`,
        [slug],
      )
    ).rows[0];
    return row?.id ?? null;
  });
}

/** A fila para a saúde, lida como o próprio Hub (sem pessoa nem agente). */
export async function queueSnapshot(
  db: Db,
  workspaceId: string,
): Promise<QueueSnapshot> {
  const actor: SystemActor = {
    type: "system",
    id: null,
    scope: "internal",
    workspaceId,
    name: "Hub",
  };
  const view = await inTx(
    { db, actor, source: "system", requestId: "saude" },
    readQueue,
  );
  return {
    lastTickAt: view.lastTickAt,
    overdue: view.overdue,
    failed24h: view.failed24h,
  };
}
