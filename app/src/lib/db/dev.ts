import "server-only";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { AGENT_SCOPES, hashAgentKey, parseAgentKey } from "@/lib/agent-keys";
import { applySeed, openLocalDatabase, SCHEMA } from "./local";
import type { Db } from "./types";

/** Escopos da chave de teste local: tudo o que um agente executor usa, sem administração. */
export const DEV_AGENT_SCOPES = AGENT_SCOPES.filter(
  (s) => s !== "workspace:*" && s !== "projects:import",
);

/**
 * Registra a chave de agente de desenvolvimento (HUB_DEV_AGENT_KEY no .env.local) para o
 * "Agente local de teste", com acesso ao projeto HUB. Só roda no banco local.
 */
export async function ensureDevAgentKey(
  pg: PGlite,
  key: string,
  pepper: string,
): Promise<void> {
  const parsed = parseAgentKey(key);
  if (!parsed) throw new Error("HUB_DEV_AGENT_KEY em formato inválido.");
  const exists = await pg.query(
    `select 1 from ${SCHEMA}.agent_api_keys where key_prefix = $1`,
    [parsed.prefix],
  );
  if (exists.rows.length > 0) return;
  const ws = await pg.query<{ id: string; project_id: string }>(
    `select w.id, p.id as project_id
       from ${SCHEMA}.workspaces w join ${SCHEMA}.projects p on p.workspace_id = w.id and p.code = 'HUB'
      where w.slug = 'harmony'`,
  );
  const target = ws.rows[0];
  if (!target) throw new Error("Seed da Harmony ausente no banco local.");
  const agent = await pg.query<{ id: string }>(
    `insert into ${SCHEMA}.agents (workspace_id, name, kind, mission, roles)
     values ($1, 'Agente local de teste', 'session', 'Testes locais do Hub pela API e pelo MCP.', array['GP-01'])
     on conflict (workspace_id, name) do update set name = excluded.name
     returning id`,
    [target.id],
  );
  await pg.query(
    `insert into ${SCHEMA}.agent_api_keys (workspace_id, agent_id, key_prefix, key_hash, scopes, project_ids, expires_at)
     values ($1, $2, $3, $4, $5::text[], $6::uuid[], now() + interval '90 days')`,
    [
      target.id,
      agent.rows[0].id,
      parsed.prefix,
      hashAgentKey(parsed.key, pepper),
      DEV_AGENT_SCOPES,
      [target.project_id],
    ],
  );
}

export async function openDevDatabase(options: {
  dataDir: string;
  devAgentKey: string | null;
  pepper: string | null;
  /** Projeto de exemplo para ver as telas cheias (HUB_DEV_SAMPLE=on). */
  sample?: boolean;
}): Promise<Db> {
  const dataDir = path.resolve(process.cwd(), options.dataDir);
  await mkdir(dataDir, { recursive: true });
  const { db, raw } = await openLocalDatabase(dataDir);
  await applySeed(raw);
  if (options.devAgentKey && options.pepper) {
    await ensureDevAgentKey(raw, options.devAgentKey, options.pepper);
  }
  if (options.sample) {
    const { ensureDevSample } = await import("./dev-sample");
    await ensureDevSample(db, raw);
  }
  return db;
}
