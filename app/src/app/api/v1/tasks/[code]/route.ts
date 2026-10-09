import { apiRoute, ok } from "@/lib/http/api";
import { UpdateTaskInput } from "@/modules/tasks/schemas";
import { getTask, updateTask } from "@/modules/tasks/service";

/** Detalhe da tarefa. O ETag traz a versão, para usar em If-Match no PATCH. */
export const GET = apiRoute<{ code: string }>({
  handler: async ({ t, params }) => ok(await getTask(t, params.code)),
});

/**
 * Atualiza campos da tarefa. Com If-Match, recusa (412) se outra escrita veio antes.
 * Concluir e bloquear têm ações próprias.
 */
export const PATCH = apiRoute<{ code: string }>({
  write: true,
  handler: async ({ t, params, body, ifMatch }) =>
    ok(await updateTask(t, params.code, UpdateTaskInput.parse(body), ifMatch)),
});
