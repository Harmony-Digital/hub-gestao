import { maybeOne, S, type TxCtx } from "@/modules/context";
import { emitEvent } from "@/modules/events";
import { notifyOwners } from "@/modules/notifications";

/**
 * O cliente confirmou no portal que recebeu uma entrega (opção do projeto, D9; não é o
 * aceite). Avisa os donos na caixa de entrada e os webhooks que assinam
 * "client.receipt_confirmed". Roda como o próprio Hub, depois de a confirmação estar
 * gravada (função confirm_milestone_receipt, migração 0018).
 */
export async function noteReceiptConfirmed(
  t: TxCtx,
  milestoneId: string,
): Promise<void> {
  const row = await maybeOne<{
    project_id: string;
    project_code: string;
    milestone_code: string;
    title_client: string | null;
    by_name: string | null;
  }>(
    t,
    `select p.id as project_id, p.code as project_code, m.code as milestone_code,
            m.title_client, m.client_received_by_name as by_name
       from ${S}.milestones m join ${S}.projects p on p.id = m.project_id
      where m.id = $1 and m.client_received_at is not null`,
    [milestoneId],
  );
  if (!row) return;
  const payload = {
    project_code: row.project_code,
    milestone: row.milestone_code,
    title: row.title_client,
    author: row.by_name,
  };
  await notifyOwners(
    t,
    "client.receipt",
    { type: "milestone", id: milestoneId },
    payload,
  );
  await emitEvent(t, "client.receipt_confirmed", payload);
}
