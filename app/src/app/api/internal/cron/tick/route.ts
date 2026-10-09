import { createHash, timingSafeEqual } from "node:crypto";
import { bearerToken } from "@/lib/agent-keys";
import { applyRuntimeRole } from "@/lib/db/actor";
import { getDb } from "@/lib/db";
import { cronSecret, encryptionKeyOrNull, serverEnv } from "@/lib/env";
import {
  methodNotAllowed,
  serverMisconfigured,
  toHubError,
  unauthorized,
} from "@/lib/errors";
import {
  jsonResponse,
  logFailure,
  problemResponse,
  requestIdOf,
} from "@/lib/http/api";
import { log } from "@/lib/log";
import { tick } from "@/modules/jobs/service";

function sameSecret(a: string, b: string): boolean {
  // Compara os hashes para ter tamanho igual e tempo constante.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Relógio dos jobs (systemd timer na VPS, a cada 5 minutos): agenda os periódicos e roda
 * os que estão na vez. Autenticado por Authorization: Bearer <CRON_SECRET>.
 */
export async function POST(req: Request) {
  const requestId = requestIdOf(req);
  const path = new URL(req.url).pathname;
  try {
    const secret = cronSecret();
    if (!secret) {
      throw serverMisconfigured(
        "O servidor está sem CRON_SECRET (32 caracteres ou mais).",
      );
    }
    const token = bearerToken(req.headers.get("authorization"));
    if (!token || !sameSecret(token, secret)) {
      throw unauthorized("Segredo do relógio inválido.");
    }
    const db = await getDb();
    const slug = serverEnv().workspaceSlug;
    const workspaceId = await db.transaction(async (tx) => {
      await applyRuntimeRole(db, tx);
      return (
        await tx.query<{ id: string | null }>(
          "select proj_hub_gestao.workspace_id_by_slug($1) as id",
          [slug],
        )
      ).rows[0]?.id;
    });
    if (!workspaceId) {
      throw serverMisconfigured(`Workspace "${slug}" não encontrado no banco.`);
    }
    const result = await tick(
      db,
      workspaceId,
      { encryptionKey: encryptionKeyOrNull() },
      { requestId },
    );
    log.info(
      {
        request_id: requestId,
        enqueued: result.enqueued,
        ran: result.ran.map((r) => ({ type: r.type, status: r.status })),
      },
      "tick do relógio",
    );
    return jsonResponse(200, result, requestId);
  } catch (raw) {
    const err = toHubError(raw);
    logFailure(err, raw, requestId, path);
    return problemResponse(err, path, requestId);
  }
}

export async function GET(req: Request) {
  return problemResponse(
    methodNotAllowed("Use POST com Authorization: Bearer <CRON_SECRET>."),
    new URL(req.url).pathname,
    requestIdOf(req),
  );
}
