import type { NextRequest } from "next/server";
import { toHubError } from "@/lib/errors";
import { log } from "@/lib/log";
import { inTx } from "@/modules/context";
import { readPortalFile } from "@/modules/portal/views";
import { portalContext, portalSessionFor } from "../../../../_ui/session";

/** Imagens e PDF abrem no navegador; o resto baixa. Nada é interpretado como página. */
const INLINE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

const NOT_FOUND = () =>
  new Response("Arquivo não encontrado.", { status: 404 });

/**
 * Download de um arquivo entregue, no portal: exige a sessão do cliente do endereço, e a
 * leitura roda com o ator de cliente (a RLS só mostra o que a equipe entregou a ele).
 * Sem sessão, de outro cliente ou inexistente: a mesma resposta.
 */
export async function GET(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ cliente: string; codigo: string; id: string }> },
) {
  const { cliente, codigo, id } = await params;
  const session = await portalSessionFor(cliente);
  if (!session || !session.consentAt) return NOT_FOUND();
  try {
    const file = await inTx(await portalContext(session), (t) =>
      readPortalFile(t, codigo, id),
    );
    const inline = INLINE.has(file.mime);
    const name = encodeURIComponent(file.filename);
    return new Response(new Uint8Array(file.content), {
      headers: {
        "Content-Type": inline ? file.mime : "application/octet-stream",
        "Content-Length": String(file.content.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const status = toHubError(err).status;
    if (status >= 500) {
      log.error({ err }, "download de arquivo no portal");
      return new Response("Falha ao abrir o arquivo.", { status: 500 });
    }
    return NOT_FOUND();
  }
}
