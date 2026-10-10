import { can } from "@/lib/authorize";
import { toHubError } from "@/lib/errors";
import { log } from "@/lib/log";
import { actionContext } from "@/lib/ui-context";
import { conciergeReady } from "@/modules/concierge/service";
import { inTx } from "@/modules/context";
import { listProjects } from "@/modules/projects/service";

const HEADERS = { "Cache-Control": "private, no-store" };

/**
 * Projetos ativos de quem está logado, para a criação rápida de tarefa (de qualquer tela),
 * se a pessoa pode cadastrar projeto (atalho "Novo projeto" da janela ⌘K) e se o
 * Concierge está pronto (agente CO-10 com modelo de IA) ou sem IA configurada.
 */
export async function GET() {
  const ctx = await actionContext();
  try {
    const { projects, concierge } = await inTx(ctx, async (t) => ({
      projects: (await listProjects(t)).items.map((p) => ({
        code: p.code,
        name: p.name,
      })),
      concierge: (await conciergeReady(t)) ? "ready" : "off",
    }));
    return Response.json(
      {
        projects,
        canCreateProject: can(ctx.actor, "workspace.admin"),
        concierge,
      },
      { headers: HEADERS },
    );
  } catch (err) {
    const e = toHubError(err);
    if (e.status >= 500) {
      log.error(
        { err, request_id: ctx.requestId },
        "projetos da criação rápida",
      );
    }
    return Response.json(
      { error: e.status >= 500 ? "Falha ao listar os projetos." : e.detail },
      { status: e.status >= 500 ? 500 : e.status, headers: HEADERS },
    );
  }
}
