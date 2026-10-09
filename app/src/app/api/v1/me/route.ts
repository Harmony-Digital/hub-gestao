import { apiRoute, ok } from "@/lib/http/api";
import { whoami } from "@/modules/agents/service";

/** Identidade da chave, workspace, projetos, escopos e orçamento (PRD §8.3). */
export const GET = apiRoute({
  handler: async ({ t }) => ok(await whoami(t)),
});
