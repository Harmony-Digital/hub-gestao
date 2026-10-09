import { apiRoute, created } from "@/lib/http/api";
import { logTime, LogTimeInput } from "@/modules/time/service";

/** Registra tempo de trabalho na tarefa. */
export const POST = apiRoute<{ code: string }>({
  write: true,
  handler: async ({ t, params, body }) =>
    created(await logTime(t, params.code, LogTimeInput.parse(body))),
});
