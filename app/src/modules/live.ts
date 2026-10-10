import { resolveProject } from "@/modules/common";
import { maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Marca de mudança do projeto, para as telas se atualizarem sozinhas quando alguém
 * (pessoa ou agente) grava algo nele. Toda escrita deixa registro no histórico, então a
 * marca junta a contagem e o maior número do histórico do projeto: só o maior número
 * não basta, porque um registro de uma transação mais antiga pode aparecer depois de
 * outro mais novo. Quem não lê as tarefas do projeto recebe a mesma recusa das telas.
 */
export async function projectChangeMarker(
  t: TxCtx,
  projectCode: string,
): Promise<string> {
  const project = await resolveProject(t, projectCode, "task.read");
  const row = await maybeOne<{ n: number; last: string | null }>(
    t,
    `select count(*)::int as n, max(id)::text as last
       from ${S}.activity_log
      where project_id = $1`,
    [project.id],
  );
  return `${row?.n ?? 0}.${row?.last ?? 0}`;
}
