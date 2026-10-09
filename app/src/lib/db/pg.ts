import "server-only";
import { Pool, types } from "pg";
import type { Db, Queryable, Row } from "./types";

/**
 * Banco de produção (M2): pool do node-postgres. Datas (DATE) voltam como texto,
 * inteiros grandes e numéricos como número, igual ao banco local (PGlite).
 */
const typeParsers = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === types.builtins.DATE) return (value: string) => value;
    if (oid === types.builtins.INT8 || oid === types.builtins.NUMERIC) {
      return (value: string) => Number(value);
    }
    return types.getTypeParser(oid, format);
  },
} as const;

export function pgDb(connectionString: string, runtimeRole?: string): Db {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "hub-gestao",
    types: typeParsers as never,
  });
  const wrap = (client: Pick<Pool, "query">): Queryable => ({
    async query<T extends Row = Row>(sql: string, params?: unknown[]) {
      const result = await client.query(sql, params as unknown[] | undefined);
      return { rows: result.rows as T[] };
    },
  });
  return {
    runtimeRole,
    ...wrap(pool),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(wrap(client));
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
