import { apiRoute, ok } from "@/lib/http/api";
import { today } from "@/modules/today/service";

/** Fila do ator: minhas tarefas, bloqueios, prazos próximos e aprovações. */
export const GET = apiRoute({
  handler: async ({ t }) => ok(await today(t)),
});
