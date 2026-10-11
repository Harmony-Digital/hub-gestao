import { apiRoute, ok } from "@/lib/http/api";
import { projectTime } from "@/modules/time/service";

/** Tempo do projeto (TO-15): por pessoa ou agente, por frente, estimado e desvios. */
export const GET = apiRoute<{ code: string }>({
  handler: async ({ t, params }) => ok(await projectTime(t, params.code)),
});
