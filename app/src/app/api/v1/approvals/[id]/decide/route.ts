import { apiRoute, ok } from "@/lib/http/api";
import {
  decideApproval,
  DecideApprovalInput,
} from "@/modules/approvals/service";
import { Uuid } from "@/modules/common";

/**
 * Decisão sobre um pedido. É de uma pessoa (owner), pela sessão web do Hub (M3).
 * Com chave de agente, a resposta é sempre 403: agentes pedem, não decidem (RF-26).
 */
export const POST = apiRoute<{ id: string }>({
  write: true,
  handler: async ({ t, params, body }) =>
    ok(
      await decideApproval(
        t,
        Uuid.parse(params.id),
        DecideApprovalInput.parse(body),
      ),
    ),
});
