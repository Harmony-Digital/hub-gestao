import { apiRoute, ok } from "@/lib/http/api";
import { CompleteTaskInput } from "@/modules/tasks/schemas";
import { completeTask } from "@/modules/tasks/service";

/** Conclui a tarefa. Evidência obrigatória: SHA, URL, arquivo ou teste. */
export const POST = apiRoute<{ code: string }>({
  write: true,
  handler: async ({ t, params, body }) =>
    ok(await completeTask(t, params.code, CompleteTaskInput.parse(body))),
});
