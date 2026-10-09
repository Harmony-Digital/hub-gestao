import { apiRoute, created, ok } from "@/lib/http/api";
import {
  createWorkstream,
  CreateWorkstreamInput,
  listWorkstreams,
} from "@/modules/workstreams/service";

/** Frentes do projeto (camada tática). */
export const GET = apiRoute<{ code: string }>({
  handler: async ({ t, params }) => ok(await listWorkstreams(t, params.code)),
});

/** Nova frente, sempre interna. Mostrar ao cliente é pedido de aprovação. */
export const POST = apiRoute<{ code: string }>({
  write: true,
  handler: async ({ t, params, body }) =>
    created(
      await createWorkstream(
        t,
        CreateWorkstreamInput.parse({
          ...(body as object),
          project: params.code,
        }),
      ),
    ),
});
