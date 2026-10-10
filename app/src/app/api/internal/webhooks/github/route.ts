import { getDb } from "@/lib/db";
import { applyRuntimeRole } from "@/lib/db/actor";
import { githubWebhookSecret, serverEnv } from "@/lib/env";
import {
  badRequest,
  payloadTooLarge,
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
import { handleGithubEvent, validSignature } from "@/modules/github/webhook";

const MAX_BODY = 5 * 1024 * 1024;

/**
 * Webhook do GitHub, um por repositório (eventos push e pull_request). Autenticado pela
 * assinatura X-Hub-Signature-256 com GITHUB_WEBHOOK_SECRET; sem o segredo configurado, o
 * servidor recusa tudo. Instalação em docs/github-webhook.md.
 */
export async function POST(req: Request) {
  const requestId = requestIdOf(req);
  const path = new URL(req.url).pathname;
  try {
    const secret = githubWebhookSecret();
    if (!secret) {
      throw serverMisconfigured(
        "O servidor está sem GITHUB_WEBHOOK_SECRET (32 caracteres ou mais).",
      );
    }
    const body = await req.text();
    if (body.length > MAX_BODY) {
      throw payloadTooLarge("O evento do GitHub passou de 5 MB.");
    }
    if (!validSignature(secret, body, req.headers.get("x-hub-signature-256"))) {
      throw unauthorized("Assinatura do GitHub inválida.");
    }
    const event = req.headers.get("x-github-event") ?? "";
    if (event === "ping") {
      return jsonResponse(200, { ok: true, event }, requestId);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw badRequest("O evento do GitHub não veio em JSON.");
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
    const result = await handleGithubEvent(
      db,
      workspaceId,
      event,
      payload,
      requestId,
    );
    log.info(
      {
        request_id: requestId,
        delivery: req.headers.get("x-github-delivery"),
        ...result,
      },
      "webhook do GitHub",
    );
    return jsonResponse(200, result, requestId);
  } catch (raw) {
    const err = toHubError(raw);
    logFailure(err, raw, requestId, path);
    return problemResponse(err, path, requestId);
  }
}
