import { apiRoute, ok } from "@/lib/http/api";
import { listProjectFields } from "@/modules/tasks/custom-fields";

/** Campos personalizados das tarefas do projeto: nome, tipo e opções da seleção. */
export const GET = apiRoute<{ code: string }>({
  handler: async ({ t, params }) =>
    ok({ items: await listProjectFields(t, params.code) }),
});
