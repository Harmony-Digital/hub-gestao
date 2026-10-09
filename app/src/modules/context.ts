import { withActor, type Actor } from "@/lib/db/actor";
import type { Db, Queryable, Row } from "@/lib/db/types";
import { notFound } from "@/lib/errors";

/** Schema do Hub no Supabase compartilhado. */
export const S = "proj_hub_gestao";

/** Origem da ação, gravada no registro de atividades. */
export type Source =
  "ui" | "api" | "mcp" | "sync" | "cron" | "webhook" | "system";

/** Quem está agindo, por onde e em qual pedido. */
export type Ctx = {
  db: Db;
  actor: Actor;
  source: Source;
  requestId: string;
};

/** Contexto dentro de uma transação já aberta com o contexto do ator. */
export type TxCtx = Ctx & { tx: Queryable };

/** Abre uma transação com o contexto do ator (RLS) e roda o caso de uso. */
export function inTx<T>(ctx: Ctx, fn: (t: TxCtx) => Promise<T>): Promise<T> {
  return withActor(ctx.db, ctx.actor, (tx) => fn({ ...ctx, tx }));
}

export async function many<T extends Row>(
  t: TxCtx,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await t.tx.query<T>(sql, params)).rows;
}

export async function maybeOne<T extends Row>(
  t: TxCtx,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  return (await t.tx.query<T>(sql, params)).rows[0] ?? null;
}

export async function one<T extends Row>(
  t: TxCtx,
  sql: string,
  params: unknown[],
  missing: string,
): Promise<T> {
  const row = await maybeOne<T>(t, sql, params);
  if (!row) throw notFound(missing);
  return row;
}

/** Parâmetro JSON: sempre texto + cast ::jsonb, igual no pg e no PGlite. */
export const json = (value: unknown): string | null =>
  value === undefined ? null : JSON.stringify(value);
