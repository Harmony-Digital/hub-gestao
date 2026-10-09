import { z } from "zod";
import { apiRoute, ok } from "@/lib/http/api";
import { startTask } from "@/modules/tasks/service";

/** Inicia a tarefa e a atribui a quem chama, se estiver livre. Uma por agente, por padrão. */
export const POST = apiRoute<{ code: string }>({
  write: true,
  handler: async ({ t, params, body }) => {
    z.strictObject({}).parse(body);
    return ok(await startTask(t, params.code));
  },
});
