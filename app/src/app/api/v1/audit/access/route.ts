import { apiRoute, ok } from "@/lib/http/api";
import { accessAudit } from "@/modules/audit/access";

/** Auditoria de acesso e segurança (AC-14): os pontos para o dono olhar, com o que fazer. */
export const GET = apiRoute({
  handler: async ({ t }) => ok(await accessAudit(t)),
});
