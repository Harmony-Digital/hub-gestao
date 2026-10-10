import "server-only";
import { serverEnv } from "@/lib/env";
import type { Db } from "./types";

/**
 * Banco do processo. Produção (M2): DATABASE_URL com o papel dedicado do Hub.
 * Desenvolvimento: PGlite em .data/pglite, com as mesmas migrations e o seed da Harmony.
 * Uma instância por processo, guardada fora do módulo para sobreviver ao recarregamento.
 */
const holder = globalThis as unknown as { __hubDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  holder.__hubDb ??= openDb().catch((err: unknown) => {
    holder.__hubDb = undefined;
    throw err;
  });
  return holder.__hubDb;
}

/** Testes: usa um banco preparado pelo próprio teste. */
export function setDbForTests(db: Db | null): void {
  holder.__hubDb = db ? Promise.resolve(db) : undefined;
}

async function openDb(): Promise<Db> {
  const env = serverEnv();
  if (env.databaseUrl) {
    const { pgDb } = await import("./pg");
    const { assertRlsEnforced } = await import("./guard");
    const db = pgDb(env.databaseUrl, env.dbRuntimeRole ?? undefined);
    try {
      await assertRlsEnforced(db);
    } catch (err) {
      await db.close().catch(() => undefined);
      throw err;
    }
    return db;
  }
  // O teste usa process.env.NODE_ENV direto: no build de produção ele vira constante e
  // o ramo inteiro some, junto com o banco local (PGlite) e o acesso a arquivos dele.
  if (process.env.NODE_ENV !== "production") {
    const { openDevDatabase } = await import("./dev");
    return openDevDatabase({
      dataDir: env.dataDir,
      devAgentKey: env.devAgentKey,
      pepper: process.env.HUB_API_KEY_PEPPER ?? null,
      sample: process.env.HUB_DEV_SAMPLE === "on",
    });
  }
  throw new Error("DATABASE_URL é obrigatório em produção.");
}
