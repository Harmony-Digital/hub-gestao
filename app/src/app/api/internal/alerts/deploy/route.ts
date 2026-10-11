import { createHash, timingSafeEqual } from "node:crypto";
import { bearerToken } from "@/lib/agent-keys";
import type { SystemActor } from "@/lib/db/actor";
import { getDb } from "@/lib/db";
import { alertSecret, serverEnv } from "@/lib/env";
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
import { DeployAlertInput, noteDeployFailed } from "@/modules/ops/alerts";
import { workspaceIdBySlug } from "@/modules/ops/health";

function sameSecret(a: string, b: string): boolean {
  // Compara os hashes para ter tamanho igual e tempo constante.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Aviso de publicação que falhou (M8): o passo final do workflow "Publicação na VPS"
 * chama com Authorization: Bearer <HUB_ALERT_SECRET>, o commit e o endereço da execução.
 * O Hub avisa o dono e os webhooks (Telegram, pelo Hermes), uma vez por commit.
 */
export async function POST(req: Request) {
  const requestId = requestIdOf(req);
  const path = new URL(req.url).pathname;
  try {
    const secret = alertSecret();
    if (!secret) {
      throw serverMisconfigured(
        "O aviso de publicação está desligado: falta HUB_ALERT_SECRET (32 caracteres ou mais) no servidor.",
      );
    }
    const token = bearerToken(req.headers.get("authorization"));
    if (!token || !sameSecret(token, secret)) {
      throw unauthorized("Segredo do aviso inválido.");
    }
    const body: unknown = await req.json().catch(() => {
      throw badRequest("Corpo JSON inválido.");
    });
    const input = DeployAlertInput.parse(body);
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
    const created = await inTx(
      { db, actor, source: "system", requestId },
      (t) => noteDeployFailed(t, input),
    );
    return jsonResponse(202, { ok: true, new: created }, requestId);
  } catch (raw) {
    const err = toHubError(raw);
    logFailure(err, raw, requestId, path);
    return problemResponse(err, path, requestId);
  }
}
