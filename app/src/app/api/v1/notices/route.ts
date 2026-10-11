import { apiRoute, created } from "@/lib/http/api";
import { AgentNoticeInput, postAgentNotice } from "@/modules/agent-notices";

/** Aviso do agente na caixa de entrada (o digest, lembretes): só agentes, comments:write. */
export const POST = apiRoute({
  write: true,
  handler: async ({ t, body }) =>
    created(await postAgentNotice(t, AgentNoticeInput.parse(body))),
});
