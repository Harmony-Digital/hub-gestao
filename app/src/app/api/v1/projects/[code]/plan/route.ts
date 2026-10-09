import { badRequest } from "@/lib/errors";
import { apiRoute, ok } from "@/lib/http/api";
import { getPlan, renderPlanMarkdown } from "@/modules/projects/service";

/**
 * Árvore do plano: marcos, frentes e tarefas. Com ?format=md, devolve também o texto
 * no formato plan.md (exportação simples; a sincronização chega no M4).
 */
export const GET = apiRoute<{ code: string }>({
  handler: async ({ t, params, url }) => {
    const format = url.searchParams.get("format") ?? "json";
    if (format !== "json" && format !== "md") {
      throw badRequest('format aceita "json" ou "md".');
    }
    const plan = await getPlan(t, params.code);
    return ok(
      format === "md"
        ? {
            project_code: plan.project.code,
            markdown: renderPlanMarkdown(plan),
          }
        : plan,
    );
  },
});
