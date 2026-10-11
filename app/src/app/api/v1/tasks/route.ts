import { apiRoute, created, ok, parseQuery } from "@/lib/http/api";
import { taskFilterFromQuery } from "@/lib/http/queries";
import { CreateTaskInput, TaskFilter } from "@/modules/tasks/schemas";
import { createTask, listTasks } from "@/modules/tasks/service";

/**
 * Tarefas no escopo da chave. Filtros: project, assignee (me | none | agent:<id> |
 * user:<id>), status_category (lista separada por vírgula), due_before (inclusive),
 * blocked, workstream_id, department (slug), label, parent; paginação por cursor e limit.
 */
export const GET = apiRoute({
  handler: async ({ t, url }) =>
    ok(await listTasks(t, parseQuery(url, TaskFilter, taskFilterFromQuery))),
});

/** Nova tarefa operacional (camada 3), com código HUB-n gerado pelo Hub. */
export const POST = apiRoute({
  write: true,
  handler: async ({ t, body }) =>
    created(await createTask(t, CreateTaskInput.parse(body))),
});
