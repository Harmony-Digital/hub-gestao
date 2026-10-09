import { apiRoute, ok } from "@/lib/http/api";
import { getApproval } from "@/modules/approvals/service";
import { Uuid } from "@/modules/common";

/** Detalhe de um pedido de aprovação. */
export const GET = apiRoute<{ id: string }>({
  handler: async ({ t, params }) =>
    ok(await getApproval(t, Uuid.parse(params.id))),
});
