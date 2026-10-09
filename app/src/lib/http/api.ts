import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Actor } from "@/lib/db/actor";
import { getDb } from "@/lib/db";
import { apiKeyPepper, serverEnv } from "@/lib/env";
import {
  badRequest,
  HubError,
  payloadTooLarge,
  problemBody,
  toHubError,
  tooManyRequests,
  unsupportedMediaType,
} from "@/lib/errors";
import {
  assertIdempotencyKey,
  requestHash,
  withIdempotency,
} from "@/lib/idempotency";
import { log } from "@/lib/log";
import { RateLimiter } from "@/lib/rate-limit";
import {
  authenticateAgent,
  touchKey,
  withActingRole,
} from "@/modules/agents/service";
import { inTx, type Ctx, type TxCtx } from "@/modules/context";

/** Limite de corpo do pedido (PRD §8.8). */
export const MAX_BODY_BYTES = 1_000_000;

export type ApiCall<P> = {
  req: Request;
  url: URL;
  params: P;
  t: TxCtx;
  body: unknown;
  /** Versão esperada vinda de If-Match (PATCH de tarefa). */
  ifMatch: number | undefined;
};

export type ApiResult = { status: number; body: unknown };

type RouteContext<P> = { params: Promise<P> };

const limiters = new Map<number, RateLimiter>();
function limiterFor(perMinute: number): RateLimiter {
  let limiter = limiters.get(perMinute);
  if (!limiter) {
    limiter = new RateLimiter(perMinute, 60_000);
    limiters.set(perMinute, limiter);
  }
  return limiter;
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,100}$/;

function headersFor(
  requestId: string,
  extra: Record<string, string> = {},
): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
    ...extra,
  });
  return headers;
}

export function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
  extra: Record<string, string> = {},
): Response {
  const headers = headersFor(requestId, {
    "Content-Type": "application/json; charset=utf-8",
    ...extra,
  });
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

export function problemResponse(
  err: HubError,
  instance: string,
  requestId: string,
): Response {
  const extra: Record<string, string> = {
    "Content-Type": "application/problem+json; charset=utf-8",
  };
  if (err.status === 401) extra["WWW-Authenticate"] = 'Bearer realm="hub"';
  if (err.status === 429 && typeof err.extra.retry_after === "number") {
    extra["Retry-After"] = String(err.extra.retry_after);
  }
  return new Response(JSON.stringify(problemBody(err, instance, requestId)), {
    status: err.status,
    headers: headersFor(requestId, extra),
  });
}

/** ETag fraco com a versão da tarefa, para If-Match no PATCH (PRD §8.3). */
function etagOf(body: unknown): Record<string, string> {
  if (body && typeof body === "object" && "version" in body && "code" in body) {
    const version = (body as { version: unknown }).version;
    if (typeof version === "number") return { ETag: `W/"v${version}"` };
  }
  return {};
}

function parseIfMatch(header: string | null): number | undefined {
  if (!header) return undefined;
  const match = /^(?:W\/)?"?v?(\d+)"?$/.exec(header.trim());
  if (!match) {
    throw badRequest(
      'If-Match inválido: use o ETag recebido na leitura, como W/"v3".',
    );
  }
  return Number(match[1]);
}

async function readJsonBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES)
    throw payloadTooLarge("O corpo passa de 1 MB.");
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES)
    throw payloadTooLarge("O corpo passa de 1 MB.");
  if (text.trim() === "") return {};
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw unsupportedMediaType(
      "Envie o corpo como JSON, com Content-Type: application/json.",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest("O corpo não é um JSON válido.");
  }
}

/** Autentica o agente pela chave Bearer, aplica limite e o papel declarado. */
export async function authenticateRequest(
  req: Request,
): Promise<{ actor: Actor; ctxBase: Omit<Ctx, "source" | "requestId"> }> {
  const env = serverEnv();
  const pepper = apiKeyPepper();
  const db = await getDb();
  const agent = await authenticateAgent(
    db,
    req.headers.get("authorization"),
    pepper,
  );
  const allowed = limiterFor(env.rateLimitPerMinute).take(agent.keyId);
  if (!allowed.ok) {
    throw tooManyRequests(
      `Limite de ${env.rateLimitPerMinute} pedidos por minuto atingido para esta chave.`,
      allowed.retryAfter,
    );
  }
  const actor = withActingRole(agent, req.headers.get("hub-acting-role"));
  return { actor, ctxBase: { db, actor } };
}

export function requestIdOf(req: Request): string {
  const incoming = req.headers.get("x-request-id");
  return incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export function logFailure(
  err: HubError,
  raw: unknown,
  requestId: string,
  path: string,
) {
  if (err.status >= 500) {
    const cause = raw as { code?: unknown; message?: unknown };
    log.error(
      {
        request_id: requestId,
        path,
        status: err.status,
        cause_code: typeof cause?.code === "string" ? cause.code : undefined,
        cause:
          typeof cause?.message === "string"
            ? cause.message.slice(0, 300)
            : undefined,
      },
      "falha no pedido",
    );
  }
}

/**
 * Rota da API v1 para agentes. Leitura: GET sem efeitos. Escrita: exige Idempotency-Key
 * e roda reserva da chave, mudança e auditoria na mesma transação.
 *
 * A rota lê os cabeçalhos do pedido logo no início. Com Cache Components, isso basta para
 * o GET rodar a cada pedido, sem pré-renderização (docs locais do Next.js, "Route Handlers
 * with Cache Components"); por isso não há connection() aqui.
 */
export function apiRoute<
  P extends Record<string, string> = Record<string, never>,
>(options: {
  write?: boolean;
  handler: (call: ApiCall<P>) => Promise<ApiResult>;
}) {
  return async (
    req: Request,
    routeContext?: RouteContext<P>,
  ): Promise<Response> => {
    const requestId = requestIdOf(req);
    const url = new URL(req.url);
    try {
      const { actor, ctxBase } = await authenticateRequest(req);
      const params = routeContext ? await routeContext.params : ({} as P);
      const ctx: Ctx = { ...ctxBase, actor, source: "api", requestId };
      const ifMatch = parseIfMatch(req.headers.get("if-match"));

      if (options.write) {
        const body = await readJsonBody(req);
        const key = assertIdempotencyKey(req.headers.get("idempotency-key"));
        const hash = requestHash(req.method, url.pathname + url.search, body);
        const { replayed, response } = await inTx(ctx, async (t) => {
          if (actor.type === "agent") await touchKey(t, actor.keyId);
          return withIdempotency(t, key, hash, () =>
            options.handler({ req, url, params, t, body, ifMatch }),
          );
        });
        return jsonResponse(response.status, response.body, requestId, {
          "Idempotent-Replayed": replayed ? "true" : "false",
          ...etagOf(response.body),
        });
      }

      const result = await inTx(ctx, async (t) => {
        if (actor.type === "agent") await touchKey(t, actor.keyId);
        return options.handler({
          req,
          url,
          params,
          t,
          body: undefined,
          ifMatch,
        });
      });
      return jsonResponse(
        result.status,
        result.body,
        requestId,
        etagOf(result.body),
      );
    } catch (raw) {
      const err = toHubError(raw);
      logFailure(err, raw, requestId, url.pathname);
      return problemResponse(err, url.pathname, requestId);
    }
  };
}

export const ok = (body: unknown): ApiResult => ({ status: 200, body });
export const created = (body: unknown): ApiResult => ({ status: 201, body });

/** Lê os parâmetros de consulta com um esquema zod (valores repetidos viram lista). */
export function parseQuery<S extends z.ZodType>(
  url: URL,
  schema: S,
  transform?: (raw: Record<string, string>) => unknown,
): z.infer<S> {
  const raw: Record<string, string> = {};
  for (const [key, value] of url.searchParams) raw[key] = value;
  return schema.parse(transform ? transform(raw) : raw);
}
