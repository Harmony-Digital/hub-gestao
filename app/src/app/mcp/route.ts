import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { serverEnv } from "@/lib/env";
import { badRequest, methodNotAllowed, toHubError } from "@/lib/errors";
import {
  authenticateRequest,
  logFailure,
  problemResponse,
  readJsonBody,
  requestIdOf,
} from "@/lib/http/api";
import { claimKeyTouch, touchKey } from "@/modules/agents/service";
import { inTx, type Ctx } from "@/modules/context";
import { buildMcpServer } from "@/modules/mcp/server";

/**
 * Servidor MCP do Hub (Streamable HTTP, sem estado). Cada pedido autentica a chave Bearer,
 * conta no limite de pedidos da chave, lê o corpo com o mesmo limite de 1 MB da API e
 * aceita uma mensagem JSON-RPC por vez: lote de mensagens passaria por cima desses limites.
 */
export async function POST(req: Request): Promise<Response> {
  const requestId = requestIdOf(req);
  const path = new URL(req.url).pathname;
  try {
    const { actor, ctxBase } = await authenticateRequest(req);
    const body = await readJsonBody(req);
    if (Array.isArray(body)) {
      throw badRequest(
        "O servidor MCP do Hub não aceita lotes JSON-RPC: envie uma mensagem por pedido.",
      );
    }
    const ctx: Ctx = { ...ctxBase, actor, source: "mcp", requestId };
    if (actor.type === "agent" && claimKeyTouch(actor.keyId)) {
      await inTx(ctx, (t) => touchKey(t, actor.keyId));
    }
    const server = buildMcpServer(ctx, serverEnv().appVersion);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req, { parsedBody: body });
    } finally {
      await transport.close();
      await server.close();
    }
  } catch (raw) {
    const err = toHubError(raw);
    logFailure(err, raw, requestId, path);
    return problemResponse(err, path, requestId);
  }
}

/** Sem sessões nem fluxo de eventos: o servidor é sem estado. */
export async function GET(req: Request): Promise<Response> {
  return problemResponse(
    methodNotAllowed("O servidor MCP do Hub é sem estado: use POST em /mcp."),
    new URL(req.url).pathname,
    requestIdOf(req),
  );
}

export async function DELETE(req: Request): Promise<Response> {
  return GET(req);
}
