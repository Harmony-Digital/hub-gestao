import { z } from "zod";
import { notImplemented } from "@/lib/errors";
import { apiRoute, ok, parseQuery } from "@/lib/http/api";
import { ProjectCode } from "@/modules/common";
import { getPlan, renderPlanMarkdown } from "@/modules/projects/service";

/**
 * Exportação do plan.md (?project=CODE). É o "pull" simples do M1; o "push" com
 * preservação do arquivo e conflitos chega no M4, com a CLI hub.
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

export const POST = apiRoute({
  write: true,
  handler: async () => {
    throw notImplemented(
      "A importação e o envio do plan.md chegam no M4 (CLI hub plan push). Por enquanto, use as ações de tarefa.",
    );
  },
});
