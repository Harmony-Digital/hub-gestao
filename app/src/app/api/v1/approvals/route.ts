import { apiRoute, created, ok, parseQuery } from "@/lib/http/api";
import { approvalFilterFromQuery } from "@/lib/http/queries";
import {
  ApprovalFilter,
  listApprovals,
  requestApproval,
  RequestApprovalInput,
} from "@/modules/approvals/service";

/** Pedidos de aprovação no escopo (filtros: status, project, mine). */
export const GET = apiRoute({
  handler: async ({ t, url }) =>
    ok(
      await listApprovals(
        t,
        parseQuery(url, ApprovalFilter, approvalFilterFromQuery),
      ),
    ),
});

/** Abre um pedido de decisão para o Fábio. Agentes pedem; só pessoas decidem. */
export const POST = apiRoute({
  write: true,
  handler: async ({ t, body }) =>
    created(await requestApproval(t, RequestApprovalInput.parse(body))),
});
