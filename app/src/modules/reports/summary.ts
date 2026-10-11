import { resolveProject } from "@/modules/common";
import { many, S, type TxCtx } from "@/modules/context";
import type { PeriodFacts } from "./summary-text";

/**
 * O que aconteceu num projeto no período (datas no fuso do workspace, que a transação
 * já usa): marcos entregues ou aceitos, tarefas concluídas, bloqueadas agora e o próximo
 * marco. Para quem pode rascunhar relatório do projeto.
 */
export async function periodFacts(
  t: TxCtx,
  projectCode: string,
  start: string,
  end: string,
): Promise<PeriodFacts> {
  const project = await resolveProject(t, projectCode, "report.draft");
  const milestones = await many<{
    code: string;
    title: string;
    title_client: string | null;
    visibility: string;
    status: string;
    due: string | null;
    done_on: string | null;
  }>(
    t,
    `select code, title, title_client, visibility::text as visibility,
            status::text as status, due_date::text as due,
            coalesce(delivered_at, accepted_at)::date::text as done_on
       from ${S}.milestones
      where project_id = $1 and archived_at is null
      order by sort_order, code`,
    [project.id],
  );
  const open = milestones.filter(
    (m) => m.status !== "delivered" && m.status !== "accepted",
  );
  const nextClient = open.find(
    (m) => m.visibility === "client" && m.title_client,
  );
  const completed = await many<{ code: string; title: string }>(
    t,
    `select code, title from ${S}.tasks
      where project_id = $1 and archived_at is null and status_category = 'done'
        and completed_at::date between $2::date and $3::date
      order by completed_at, code limit 100`,
    [project.id, start, end],
  );
  const blocked = await many<{
    code: string;
    title: string;
    blocked_reason: string | null;
  }>(
    t,
    `select code, title, blocked_reason from ${S}.tasks
      where project_id = $1 and archived_at is null and status_category = 'blocked'
      order by code limit 50`,
    [project.id],
  );
  const toRef = (m: (typeof milestones)[number]) => ({
    code: m.code,
    title: m.title,
    titleClient: m.title_client,
    client: m.visibility === "client",
  });
  return {
    delivered: milestones
      .filter((m) => m.done_on && m.done_on >= start && m.done_on <= end)
      .map(toRef),
    next: open[0] ? { ...toRef(open[0]), due: open[0].due } : null,
    nextClient: nextClient
      ? { titleClient: nextClient.title_client!, due: nextClient.due }
      : null,
    completed,
    blocked: blocked.map((b) => ({
      code: b.code,
      title: b.title,
      reason: b.blocked_reason,
    })),
  };
}
