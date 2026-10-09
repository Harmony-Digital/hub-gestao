import { apiRoute, ok } from "@/lib/http/api";
import { listMilestones } from "@/modules/milestones/service";

/** Marcos do projeto. Criar ou mudar marco é pedido de aprovação, nunca escrita direta. */
export const GET = apiRoute<{ code: string }>({
  handler: async ({ t, params }) => ok(await listMilestones(t, params.code)),
});
