import { apiRoute, ok } from "@/lib/http/api";
import { getProjectHealth } from "@/modules/projects/service";

/** Saúde calculada agora pela regra do PRD §5.7, com os motivos e os números usados. */
export const GET = apiRoute<{ code: string }>({
  handler: async ({ t, params }) => ok(await getProjectHealth(t, params.code)),
});
