import { apiRoute, ok } from "@/lib/http/api";
import { listProjects } from "@/modules/projects/service";

/** Projetos no escopo da chave. */
export const GET = apiRoute({
  handler: async ({ t }) => ok(await listProjects(t)),
});
