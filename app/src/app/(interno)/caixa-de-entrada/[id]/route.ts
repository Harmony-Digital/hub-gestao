import { NextResponse, type NextRequest } from "next/server";
import { actionContext } from "@/lib/ui-context";
import { inTx, maybeOne, S } from "@/modules/context";
import { describeNotification, markRead } from "@/modules/notifications";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Abrir um aviso: marca como lido e leva ao que ele aponta (ou de volta à caixa). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const back = new URL("/caixa-de-entrada", request.url);
  if (!UUID.test(id)) return NextResponse.redirect(back);
  const ctx = await actionContext();
  const href = await inTx(ctx, async (t) => {
    const row = await maybeOne<{
      type: string;
      payload: Record<string, unknown>;
    }>(
      t,
      `select type, payload from ${S}.notifications where id = $1 and profile_id = $2`,
      [id, ctx.actor.id],
    );
    if (!row) return null;
    await markRead(t, [id]);
    return describeNotification(row.type, row.payload ?? {}).href;
  });
  return NextResponse.redirect(href ? new URL(href, request.url) : back);
}
