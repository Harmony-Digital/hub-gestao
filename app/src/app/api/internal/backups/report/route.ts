import { createHash, timingSafeEqual } from "node:crypto";
import { bearerToken } from "@/lib/agent-keys";
import type { SystemActor } from "@/lib/db/actor";
import { getDb } from "@/lib/db";
import { cronSecret, serverEnv } from "@/lib/env";
import {
  badRequest,
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
import { inTx } from "@/modules/context";
import { BackupReportInput, noteBackupDone } from "@/modules/ops/alerts";
import { workspaceIdBySlug } from "@/modules/ops/health";

function sameSecret(a: string, b: string): boolean {
  // Compara os hashes para ter tamanho igual e tempo constante.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Backup que deu certo (M8): os scripts da VPS (`hub-backup.sh` e
 * `hub-backup-offsite.sh`) avisam pelo próprio contêiner, com o CRON_SECRET
 * (`app/scripts/backup-report.mjs`). Sem aviso por mais de 30 horas, o job ops-watch
 * alerta o dono (`watchBackups`).
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
    const body: unknown = await req.json().catch(() => {
      throw badRequest("Corpo JSON inválido.");
    });
    const input = BackupReportInput.parse(body);
    const db = await getDb();
    const workspaceId = await workspaceIdBySlug(db, serverEnv().workspaceSlug);
    if (!workspaceId) {
      throw serverMisconfigured(
        "Workspace do servidor não encontrado no banco.",
      );
    }
    const actor: SystemActor = {
      type: "system",
      id: null,
      scope: "internal",
      workspaceId,
      name: "Hub",
    };
    await inTx({ db, actor, source: "system", requestId }, (t) =>
      noteBackupDone(t, input),
    );
    return jsonResponse(202, { ok: true }, requestId);
  } catch (raw) {
    const err = toHubError(raw);
    logFailure(err, raw, requestId, path);
    return problemResponse(err, path, requestId);
  }
}
