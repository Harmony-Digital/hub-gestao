import { toHubError } from "@/lib/errors";
import { log } from "@/lib/log";
import { actionContext } from "@/lib/ui-context";
import { controlRoomMarker } from "@/modules/agents/control-room";
import { inTx } from "@/modules/context";

/**
 * Marca de mudança da Sala de Controle, consultada pela tela aberta (`LiveRefresh`) para
 * mostrar na hora o que os agentes fazem e as recusas novas. Só com sessão.
 */
export async function GET() {
  const ctx = await actionContext();
  try {
    const marker = await inTx(ctx, (t) => controlRoomMarker(t));
    return Response.json(
      { marker },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    const status = toHubError(err).status;
    if (status >= 500) {
      log.error(
        { err, request_id: ctx.requestId },
        "marca da Sala de Controle",
      );
    }
    return Response.json(
      { error: status >= 500 ? "Falha ao consultar." : "Sem acesso." },
      {
        status: status >= 500 ? 500 : 403,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
