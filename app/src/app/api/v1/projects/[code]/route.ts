import { apiRoute, ok } from "@/lib/http/api";
import { getProject } from "@/modules/projects/service";

/** Detalhe do projeto: saúde, progresso, departamentos e próximos marcos. */
export const GET = apiRoute<{ code: string }>({
  handler: async ({ t, params }) => ok(await getProject(t, params.code)),
});
