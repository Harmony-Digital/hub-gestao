import { apiRoute, ok } from "@/lib/http/api";
import { ActivityExportInput, exportActivity } from "@/modules/activity/export";

/**
 * Atividade de um projeto por período (RF-43), em JSON. Para agentes, sempre com o
 * projeto: a de todos os projetos é do dono e da administração, pela tela.
 */
export const GET = apiRoute({
  handler: async ({ t, url }) =>
    ok(
      await exportActivity(
        t,
        ActivityExportInput.parse({
          project: url.searchParams.get("project") ?? undefined,
          from: url.searchParams.get("from") ?? "",
          to: url.searchParams.get("to") ?? "",
        }),
      ),
    ),
});
