import type { NextRequest } from "next/server";
import { toHubError } from "@/lib/errors";
import { actionContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { exportClientData } from "@/modules/privacy/service";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Exportação dos dados do cliente e dos contatos dele (LGPD, pedido de acesso ou de
 * portabilidade), em JSON. Com sessão, só o dono.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const ctx = await actionContext();
  if (slug.length > 80 || !SLUG.test(slug)) {
    return new Response("Cliente não encontrado.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  try {
    const data = await inTx(ctx, (t) => exportClientData(t, slug));
    const name = `dados-${slug}-${data.gerado_em.slice(0, 10)}.json`;
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const error = toHubError(err);
    return new Response(
      error.status === 403 || error.status === 404
        ? "Cliente não encontrado ou fora do seu alcance (só o dono exporta)."
        : "Falha ao exportar os dados do cliente.",
      {
        status: error.status >= 500 ? 500 : error.status,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }
}
