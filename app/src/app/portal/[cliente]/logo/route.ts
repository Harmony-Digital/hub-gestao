import type { NextRequest } from "next/server";
import { toHubError } from "@/lib/errors";
import { log } from "@/lib/log";
import { inTx } from "@/modules/context";
import { readPortalLogo } from "@/modules/portal/views";
import { portalContext, portalSessionFor } from "../../_ui/session";

const NOT_FOUND = () => new Response("Logo não encontrado.", { status: 404 });

/**
 * O logo do cliente no portal (RF-04): exige a sessão do cliente do endereço, e a leitura
 * roda com o ator de cliente. Sem sessão, de outro cliente ou sem logo: a mesma resposta.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ cliente: string }> },
) {
  const { cliente } = await params;
  const session = await portalSessionFor(cliente);
  if (!session || !session.consentAt) return NOT_FOUND();
  try {
    const logo = await inTx(await portalContext(session), (t) =>
      readPortalLogo(t),
    );
    if (!logo) return NOT_FOUND();
    return new Response(new Uint8Array(logo.content), {
      headers: {
        "Content-Type": logo.mime,
        "Content-Length": String(logo.content.length),
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (toHubError(err).status >= 500) {
      log.error({ err }, "logo do cliente no portal");
      return new Response("Falha ao abrir o logo.", { status: 500 });
    }
    return NOT_FOUND();
  }
}
