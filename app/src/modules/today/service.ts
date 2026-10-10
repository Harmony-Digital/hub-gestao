import { z } from "zod";
import { authorize, can } from "@/lib/authorize";
import { projectScopeSql } from "@/modules/common";
import { many, type TxCtx } from "@/modules/context";
import { ApprovalDto, listApprovals } from "@/modules/approvals/service";
import { TaskSummary } from "@/modules/projects/schemas";
import { TASK_SUMMARY_SELECT, toTaskSummary } from "@/modules/projects/service";

export const TodayDto = z.object({
  my_tasks: z
    .array(TaskSummary)
    .describe("Minhas tarefas abertas, na ordem de trabalho."),
  blocked: z
    .array(TaskSummary)
    .describe("Tarefas bloqueadas nos meus projetos."),
  waiting_on_me: z
    .array(TaskSummary)
    .describe("Bloqueadas esperando por mim (eu sou quem destrava)."),
  due_soon: z
    .array(TaskSummary)
    .describe("Abertas que vencem nos próximos 3 dias."),
  pending_approvals: z
    .array(ApprovalDto)
    .describe(
      "Para o owner: o que espera decisão. Para os demais: os próprios pedidos.",
    ),
  counts: z.object({
    my_open: z.number().int(),
    in_progress: z.number().int(),
    blocked: z.number().int(),
    waiting_on_me: z.number().int(),
    due_soon: z.number().int(),
    pending_approvals: z.number().int(),
  }),
});
export type TodayDto = z.infer<typeof TodayDto>;

const ORDER = `
  order by case t.status_category when 'in_progress' then 0 when 'review' then 1
                                  when 'todo' then 2 when 'blocked' then 3 else 4 end,
           case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
           t.due_date nulls last, t.created_at`;

type SummaryRow = Parameters<typeof toTaskSummary>[0];

/** Fila consolidada do ator (PRD §8.3 /today e RF-24). */
export async function today(t: TxCtx): Promise<TodayDto> {
  authorize(t.actor, "agent.read");
  const canReadTasks = can(t.actor, "task.read");

  let myTasks: SummaryRow[] = [];
  let blocked: SummaryRow[] = [];
  let waitingOnMe: SummaryRow[] = [];
  let dueSoon: SummaryRow[] = [];
  if (canReadTasks && t.actor.id) {
    const mineParams: unknown[] = [t.actor.type, t.actor.id];
    myTasks = await many<SummaryRow>(
      t,
      `${TASK_SUMMARY_SELECT}
        where t.archived_at is null and t.status_category <> 'done'
          and t.assignee_type::text = $1 and t.assignee_id = $2
          and ${projectScopeSql(t.actor, "t.project_id", mineParams)}
        ${ORDER} limit 50`,
      mineParams,
    );
    const waitingParams: unknown[] = [t.actor.type, t.actor.id];
    waitingOnMe = await many<SummaryRow>(
      t,
      `${TASK_SUMMARY_SELECT}
        where t.archived_at is null and t.status_category = 'blocked'
          and t.blocked_on_type::text = $1 and t.blocked_on_id = $2
          and ${projectScopeSql(t.actor, "t.project_id", waitingParams)}
        ${ORDER} limit 50`,
      waitingParams,
    );
  }
  if (canReadTasks) {
    const blockedParams: unknown[] = [];
    blocked = await many<SummaryRow>(
      t,
      `${TASK_SUMMARY_SELECT}
        where t.archived_at is null and t.status_category = 'blocked'
          and ${projectScopeSql(t.actor, "t.project_id", blockedParams)}
        ${ORDER} limit 50`,
      blockedParams,
    );
    const dueParams: unknown[] = [];
    dueSoon = await many<SummaryRow>(
      t,
      `${TASK_SUMMARY_SELECT}
        where t.archived_at is null and t.status_category <> 'done'
          and t.due_date is not null and t.due_date <= current_date + 3
          and ${projectScopeSql(t.actor, "t.project_id", dueParams)}
        order by t.due_date, t.created_at limit 50`,
      dueParams,
    );
  }

  const decides = can(t.actor, "approval.decide");
  const approvals = can(t.actor, "approval.read")
    ? (
        await listApprovals(t, {
          status: "pending",
          mine: decides ? undefined : true,
        })
      ).items.slice(0, 50)
    : [];

  return {
    my_tasks: myTasks.map(toTaskSummary),
    blocked: blocked.map(toTaskSummary),
    waiting_on_me: waitingOnMe.map(toTaskSummary),
    due_soon: dueSoon.map(toTaskSummary),
    pending_approvals: approvals,
    counts: {
      my_open: myTasks.length,
      in_progress: myTasks.filter((r) => r.status_category === "in_progress")
        .length,
      blocked: blocked.length,
      waiting_on_me: waitingOnMe.length,
      due_soon: dueSoon.length,
      pending_approvals: approvals.length,
    },
  };
}
