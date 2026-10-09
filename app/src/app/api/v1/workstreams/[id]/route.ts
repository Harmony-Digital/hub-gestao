import { apiRoute, ok } from "@/lib/http/api";
import {
  getWorkstream,
  updateWorkstream,
  UpdateWorkstreamInput,
} from "@/modules/workstreams/service";

/** Detalhe de uma frente. */
export const GET = apiRoute<{ id: string }>({
  handler: async ({ t, params }) => ok(await getWorkstream(t, params.id)),
});

/** Atualiza a frente, sem mexer na visibilidade nem nos textos do cliente. */
export const PATCH = apiRoute<{ id: string }>({
  write: true,
  handler: async ({ t, params, body }) =>
    ok(await updateWorkstream(t, params.id, UpdateWorkstreamInput.parse(body))),
});
