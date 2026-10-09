import { apiRoute, ok } from "@/lib/http/api";
import { BlockTaskInput } from "@/modules/tasks/schemas";
import { blockTask } from "@/modules/tasks/service";

/** Bloqueia a tarefa, dizendo o que falta e de quem depende. */
export const POST = apiRoute<{ code: string }>({
  write: true,
  handler: async ({ t, params, body }) =>
    ok(await blockTask(t, params.code, BlockTaskInput.parse(body))),
});
