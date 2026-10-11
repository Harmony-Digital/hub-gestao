import { apiRoute, ok } from "@/lib/http/api";
import { Uuid } from "@/modules/common";
import { getMilestoneDetail } from "@/modules/milestones/dates";

/** Detalhe de um marco, com progresso, critérios de aceite e o histórico de datas. */
export const GET = apiRoute<{ id: string }>({
  handler: async ({ t, params }) =>
    ok(await getMilestoneDetail(t, Uuid.parse(params.id))),
});
