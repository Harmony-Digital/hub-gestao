import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import {
  checkClientText,
  type ClientTextContext,
  type ClientTextIssue,
} from "./check";

/**
 * O que a verificação do texto para o cliente precisa saber do workspace: o prefixo dos
 * códigos de tarefa, os nomes dos agentes e os nomes dos outros clientes (sem o próprio
 * cliente do projeto e sem a própria Harmony, que é o cliente dos projetos internos).
 */
export async function clientTextContext(
  t: TxCtx,
  projectId: string,
): Promise<ClientTextContext> {
  const row = await maybeOne<{
    prefix: string;
    client_id: string;
    ws_name: string;
  }>(
    t,
    `select w.task_prefix as prefix, p.client_id, w.name as ws_name
       from ${S}.projects p join ${S}.workspaces w on w.id = p.workspace_id
      where p.id = $1`,
    [projectId],
  );
  if (!row) return { taskPrefix: "", agentNames: [], otherClients: [] };
  const agents = await many<{ name: string }>(
    t,
    `select name from ${S}.agents`,
  );
  const clients = await many<{ name: string }>(
    t,
    `select name from ${S}.clients
      where id <> $1 and archived_at is null and lower(name) <> lower($2)`,
    [row.client_id, row.ws_name],
  );
  return {
    taskPrefix: row.prefix,
    agentNames: agents.map((a) => a.name),
    otherClients: clients.map((c) => c.name),
  };
}

/** Confere vários textos do mesmo projeto de uma vez (alertas sem repetição). */
export async function checkProjectClientTexts(
  t: TxCtx,
  projectId: string,
  texts: (string | null | undefined)[],
): Promise<ClientTextIssue[]> {
  const ctx = await clientTextContext(t, projectId);
  const seen = new Map<string, ClientTextIssue>();
  for (const text of texts) {
    if (!text) continue;
    for (const issue of checkClientText(text, ctx)) {
      seen.set(`${issue.kind}:${issue.term.toLowerCase()}`, issue);
    }
  }
  return [...seen.values()];
}
