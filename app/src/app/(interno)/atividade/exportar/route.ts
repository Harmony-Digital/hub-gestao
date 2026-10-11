import type { NextRequest } from "next/server";
import { toHubError } from "@/lib/errors";
import { actionContext } from "@/lib/ui-context";
import {
  activityCsv,
  ActivityExportInput,
  exportActivity,
} from "@/modules/activity/export";
import { inTx } from "@/modules/context";

/**
 * Download da atividade por período (RF-43), com sessão: `?projeto=HUB&de=AAAA-MM-DD&
 * ate=AAAA-MM-DD&formato=csv|json`. Sem projeto, a de todos (dono e administração).
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const ctx = await actionContext();
  const parsed = ActivityExportInput.safeParse({
    project: query.get("projeto") || undefined,
    from: query.get("de") ?? "",
    to: query.get("ate") ?? "",
  });
  if (!parsed.success) {
    return new Response("Escolha o período (de e até) com o calendário.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const json = query.get("formato") === "json";
  try {
    const data = await inTx(ctx, (t) => exportActivity(t, parsed.data));
    const name = `atividade-${data.project_code ?? "todos"}-${data.from}-a-${data.to}.${json ? "json" : "csv"}`;
    const body = json ? JSON.stringify(data, null, 2) : activityCsv(data.items);
    return new Response(body, {
      headers: {
        "Content-Type": json
          ? "application/json; charset=utf-8"
          : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const error = toHubError(err);
    return new Response(
      error.status === 422
        ? error.message
        : error.status === 403 || error.status === 404
          ? "Projeto não encontrado ou fora do seu alcance."
          : "Falha ao exportar a atividade.",
      {
        status: error.status >= 500 ? 500 : error.status,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }
}
