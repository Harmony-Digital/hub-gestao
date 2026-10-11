import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { buildHealth, queueState, type HealthChecks } from "@/lib/health";
import { log } from "@/lib/log";
import { queueSnapshot, workspaceIdBySlug } from "@/modules/ops/health";

/**
 * Saúde do Hub. Responde 200 sempre que o processo está no ar (o contêiner e a
 * publicação conferem `ok` e a versão); o banco e a fila vão em `status` e `checks`, para
 * quem monitora. A conferência do banco tem limite de tempo e fica guardada por alguns
 * segundos: o contêiner pergunta a cada 15 segundos.
 */

const CACHE_MS = 20_000;
const TIMEOUT_MS = 2_500;

let cached: { at: number; checks: HealthChecks } | null = null;
let lastDatabase: HealthChecks["database"] | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tempo esgotado")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function probe(now: Date): Promise<HealthChecks> {
  const db = await getDb();
  const workspaceId = await workspaceIdBySlug(db, serverEnv().workspaceSlug);
  if (!workspaceId) return { database: "ok", queue: "unknown" };
  try {
    const snapshot = await queueSnapshot(db, workspaceId);
    return { database: "ok", queue: queueState(snapshot, now) };
  } catch (err) {
    log.warn({ err }, "saúde: não foi possível ler a fila de jobs");
    return { database: "ok", queue: "unknown" };
  }
}

async function currentChecks(now: Date): Promise<HealthChecks> {
  if (cached && now.getTime() - cached.at < CACHE_MS) return cached.checks;
  let checks: HealthChecks;
  try {
    checks = await withTimeout(probe(now), TIMEOUT_MS);
  } catch (err) {
    checks = { database: "down", queue: "unknown" };
    if (lastDatabase !== "down") log.error({ err }, "saúde: banco fora");
  }
  lastDatabase = checks.database;
  cached = { at: now.getTime(), checks };
  return checks;
}

// Com Cache Components, um GET sem dados de pedido seria pré-renderizado no build.
// connection() garante que a saúde é calculada a cada chamada (ver docs locais do Next.js).
export async function GET() {
  await connection();
  const now = new Date();
  return Response.json(
    buildHealth(process.env, now, await currentChecks(now)),
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
