import type { NextRequest } from "next/server";
import { toHubError } from "@/lib/errors";
import { actionContext } from "@/lib/ui-context";
import { readAttachment } from "@/modules/attachments/service";
import { inTx } from "@/modules/context";

/** Imagens e PDF abrem no navegador; o resto baixa. Nada é interpretado como página. */
const INLINE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

/** Download de anexo: exige sessão e leitura de tarefas no projeto do anexo. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await actionContext();
  try {
    const file = await inTx(ctx, (t) => readAttachment(t, id));
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
    return new Response(
      status === 404 || status === 403 || status === 400
        ? "Anexo não encontrado."
        : "Falha ao abrir o anexo.",
      { status: status >= 500 ? 500 : 404 },
    );
  }
}
