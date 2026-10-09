import { apiRoute, ok } from "@/lib/http/api";
import { ReopenTaskInput } from "@/modules/tasks/schemas";
import { reopenTask } from "@/modules/tasks/service";

/** Reabre tarefa concluída ou bloqueada; o motivo, se vier, vira comentário interno. */
export const POST = apiRoute<{ code: string }>({
  write: true,
  handler: async ({ t, params, body }) =>
    ok(await reopenTask(t, params.code, ReopenTaskInput.parse(body))),
});
