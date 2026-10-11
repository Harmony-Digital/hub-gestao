import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import type { Db, Queryable, Row } from "./types";

/**
 * Banco local para desenvolvimento e testes: PGlite (Postgres 17 completo, dentro do
 * Node). Aplica as mesmas migrations do Supabase e cria o papel do app, para que as
 * regras de acesso valham localmente como valerão em produção.
 */

export const LOCAL_RUNTIME_ROLE = "hub_app";
export const SCHEMA = "proj_hub_gestao";

export function migrationsDir(): string {
  return (
    process.env.HUB_MIGRATIONS_DIR ??
    path.resolve(process.cwd(), "..", "supabase", "migrations")
  );
}

export async function listMigrations(dir = migrationsDir()): Promise<string[]> {
  const files = await readdir(dir);
  return files
    .filter((f) => /^hub_gestao_\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

export async function openPglite(dataDir?: string): Promise<PGlite> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const pg = new PGlite({
    dataDir,
    parsers: {
      [types.DATE]: (value: string) => value,
      [types.INT8]: (value: string) => Number(value),
      [types.NUMERIC]: (value: string) => Number(value),
    },
  });
  await pg.waitReady;
  return pg;
}

/** Aplica, em ordem, as migrations ainda não aplicadas. Devolve os nomes aplicados agora. */
export async function applyMigrations(
  pg: PGlite,
  dir = migrationsDir(),
): Promise<string[]> {
  await pg.exec(`
    create schema if not exists ${SCHEMA};
    create table if not exists public.hub_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
  `);
  const done = new Set(
    (
      await pg.query<{ name: string }>("select name from public.hub_migrations")
    ).rows.map((r) => r.name),
  );
  const applied: string[] = [];
  for (const file of await listMigrations(dir)) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await pg.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into public.hub_migrations (name) values ($1)", [
        file,
      ]);
    });
    applied.push(file);
  }
  return applied;
}

/** Papel do app, sem login e sem bypass de RLS (espelha o papel dedicado de produção). */
export async function ensureRuntimeRole(
  pg: PGlite,
  role = LOCAL_RUNTIME_ROLE,
): Promise<void> {
  await pg.exec(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${role}') then
        create role ${role} nologin;
      end if;
    end
    $$;
    grant usage on schema ${SCHEMA} to ${role};
    grant select, insert, update, delete on all tables in schema ${SCHEMA} to ${role};
    grant usage, select on all sequences in schema ${SCHEMA} to ${role};
    grant execute on all functions in schema ${SCHEMA} to ${role};
  `);
}

export function pgliteDb(pg: PGlite, runtimeRole?: string): Db {
  const wrap = (q: Pick<PGlite, "query">): Queryable => ({
    async query<T extends Row = Row>(sql: string, params?: unknown[]) {
      const result = await q.query<T>(sql, params as unknown[] | undefined);
      return { rows: result.rows };
    },
  });
  return {
    runtimeRole,
    ...wrap(pg),
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
      pg.transaction((tx) => fn(wrap(tx))),
    close: () => pg.close(),
  };
}

export function seedsDir(): string {
  return path.resolve(migrationsDir(), "..", "seeds");
}

/** Arquivos de seed, na ordem: o workspace primeiro, depois o que depende dele. */
export const SEED_FILES = [
  "harmony_workspace.sql",
  "harmony_templates.sql",
] as const;

/** Seed da Harmony (idempotente), o mesmo aplicado no banco compartilhado. */
export async function applySeed(pg: PGlite, dir = seedsDir()): Promise<void> {
  for (const file of SEED_FILES) {
    await pg.exec(await readFile(path.join(dir, file), "utf8"));
  }
}

/** Banco local pronto: migrations aplicadas e papel do app criado. */
export async function openLocalDatabase(
  dataDir?: string,
): Promise<{ db: Db; raw: PGlite }> {
  const raw = await openPglite(dataDir);
  await applyMigrations(raw);
  await ensureRuntimeRole(raw);
  return { db: pgliteDb(raw, LOCAL_RUNTIME_ROLE), raw };
}
