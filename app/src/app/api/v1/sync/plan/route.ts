import { z } from "zod";
import { apiRoute, ok, parseQuery } from "@/lib/http/api";
import { ProjectCode } from "@/modules/common";
import { getPlan, renderPlanMarkdown } from "@/modules/projects/service";
import { syncPlan, SyncPlanInput } from "@/modules/sync/service";

/**
 * Exportação do plan.md (?project=CODE): o plano do Hub no formato do arquivo, do zero.
 * Para sincronizar um arquivo que já existe, use o POST (pull ou push).
 */
export const GET = apiRoute({
  handler: async ({ t, url }) => {
    const { project } = parseQuery(
      url,
      z.strictObject({ project: ProjectCode }),
    );
    const plan = await getPlan(t, project, "sync.plan");
    return ok({
      project_code: plan.project.code,
      plan_path: plan.project.plan_path,
      markdown: renderPlanMarkdown(plan),
    });
  },
});

/**
 * Sincroniza o plan.md com o Hub (direction "pull" ou "push"). Devolve o arquivo para
 * gravar, o resumo e os conflitos; toda execução fica em plan_sync_runs.
 */
export const POST = apiRoute({
  write: true,
  handler: async ({ t, body }) =>
    ok(await syncPlan(t, SyncPlanInput.parse(body))),
});
