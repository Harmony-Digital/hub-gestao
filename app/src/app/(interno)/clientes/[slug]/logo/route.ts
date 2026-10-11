import type { NextRequest } from "next/server";
import { readClientLogo } from "@/modules/clients/logo";
import { toHubError } from "@/lib/errors";
import { actionContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const NOT_FOUND = () => new Response("Logo não encontrado.", { status: 404 });

/** O logo do cliente (RF-04), para as telas da equipe: exige sessão. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (slug.length > 80 || !SLUG.test(slug)) return NOT_FOUND();
  const ctx = await actionContext();
  try {
    const logo = await inTx(ctx, (t) => readClientLogo(t, slug));
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
    const status = toHubError(err).status;
    return status >= 500
      ? new Response("Falha ao abrir o logo.", { status: 500 })
      : NOT_FOUND();
  }
}
