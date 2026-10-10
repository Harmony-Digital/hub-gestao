import type { NextRequest } from "next/server";
import { toHubError } from "@/lib/errors";
import { log } from "@/lib/log";
import { actionContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { projectChangeMarker } from "@/modules/live";

/**
 * Marca de mudança do projeto, consultada pelas telas abertas (`LiveRefresh`) para se
 * atualizarem quando alguém grava. Só com sessão e leitura das tarefas do projeto; a
 * resposta não diz nada além de "mudou ou não".
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const ctx = await actionContext();
  try {
    const marker = await inTx(ctx, (t) => projectChangeMarker(t, code));
    return Response.json(
      { marker },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    const status = toHubError(err).status;
    if (status >= 500) {
      log.error({ err, request_id: ctx.requestId }, "marca de mudança");
    }
    return Response.json(
      {
        error:
          status >= 500 ? "Falha ao consultar." : "Projeto não encontrado.",
      },
      {
        status: status >= 500 ? 500 : 404,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
