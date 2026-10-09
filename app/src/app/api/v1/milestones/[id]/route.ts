import { apiRoute, ok } from "@/lib/http/api";
import { Uuid } from "@/modules/common";
import { getMilestone } from "@/modules/milestones/service";

/** Detalhe de um marco, com progresso e critérios de aceite. */
export const GET = apiRoute<{ id: string }>({
  handler: async ({ t, params }) =>
    ok(await getMilestone(t, Uuid.parse(params.id))),
});
