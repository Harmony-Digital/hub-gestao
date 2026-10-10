import type { NextRequest } from "next/server";
import { toHubError } from "@/lib/errors";
import { log } from "@/lib/log";
import { actionContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { search } from "@/modules/search/service";

const HEADERS = { "Cache-Control": "private, no-store" };

/**
 * Busca da janela ⌘K: projetos, tarefas (por código ou título), marcos e frentes, só no
 * alcance de quem está logado (a mesma busca da API e do MCP).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const ctx = await actionContext();
  try {
    const result = await inTx(ctx, (t) => search(t, q));
    return Response.json(result, { headers: HEADERS });
  } catch (err) {
    const e = toHubError(err);
    if (e.status >= 500) {
      log.error({ err, request_id: ctx.requestId }, "busca da janela ⌘K");
    }
    return Response.json(
      { error: e.status >= 500 ? "Falha na busca." : e.detail },
      { status: e.status >= 500 ? 500 : e.status, headers: HEADERS },
    );
  }
}
