import { z } from "zod";
import { apiRoute, ok, parseQuery } from "@/lib/http/api";
import { search } from "@/modules/search/service";

/** Busca global no escopo da chave (?q=, de 2 a 100 caracteres). */
export const GET = apiRoute({
  handler: async ({ t, url }) => {
    const { q } = parseQuery(url, z.strictObject({ q: z.string() }));
    return ok(await search(t, q));
  },
});
