import { z } from "zod";
import { notFound } from "@/lib/errors";
import {
  ACTOR_NAME_SQL,
  ActorRef,
  actorRef,
  IsoDate,
  iso,
  resolveProject,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { MilestoneDto } from "@/modules/projects/schemas";
import { getMilestone } from "./service";

/**
 * Histórico de datas do marco (RF-11): cada mudança da data prevista, com a data de
 * antes, a nova, o motivo e quem mudou. É interno: o portal mostra só a data vigente e a
 * quantidade de revisões, nunca o motivo (migração 0016).
 */

export const DateChange = z.object({
  at: z.string(),
  from: IsoDate.nullable(),
  to: IsoDate.nullable(),
  reason: z.string().nullable(),
  by: ActorRef.nullable(),
});
export type DateChange = z.infer<typeof DateChange>;

export const MilestoneDetailDto = MilestoneDto.extend({
  date_history: z
    .array(DateChange)
    .describe(
      "Mudanças da data prevista, da mais recente para a mais antiga, com o motivo (interno: o cliente nunca vê o motivo).",
    ),
});
export type MilestoneDetailDto = z.infer<typeof MilestoneDetailDto>;

/** As mudanças de data de um marco que quem chama já pode ver. */
export async function milestoneDateHistory(
  t: TxCtx,
  milestoneId: string,
): Promise<DateChange[]> {
  const rows = await many<{
    created_at: Date | string;
    old_due: string | null;
    new_due: string | null;
    reason_internal: string | null;
    changed_by_type: string;
    changed_by_id: string | null;
    actor_name: string | null;
  }>(
    t,
    `select h.created_at, h.old_due::text as old_due, h.new_due::text as new_due,
            h.reason_internal, h.changed_by_type::text as changed_by_type, h.changed_by_id,
            ${ACTOR_NAME_SQL("h.changed_by_type::text", "h.changed_by_id")} as actor_name
       from ${S}.milestone_date_history h
      where h.milestone_id = $1
      order by h.created_at desc, h.id desc
      limit 100`,
    [milestoneId],
  );
  return rows.map((r) => ({
    at: iso(r.created_at),
    from: r.old_due,
    to: r.new_due,
    reason: r.reason_internal?.trim() || null,
    by: actorRef(r.changed_by_type, r.changed_by_id, r.actor_name),
  }));
}

/** O marco com o histórico de datas (API, MCP e a tela do histórico). */
export async function getMilestoneDetail(
  t: TxCtx,
  id: string,
): Promise<MilestoneDetailDto> {
  const milestone = await getMilestone(t, id);
  return {
    ...milestone,
    date_history: await milestoneDateHistory(t, milestone.id),
  };
}

/** O marco pelo código do projeto e o do marco (ex.: VIT e M2), para o MCP. */
export async function getMilestoneDetailByCode(
  t: TxCtx,
  projectCode: string,
  code: string,
): Promise<MilestoneDetailDto> {
  const project = await resolveProject(t, projectCode, "milestone.read");
  const row = await maybeOne<{ id: string }>(
    t,
    `select id from ${S}.milestones where project_id = $1 and code = $2`,
    [project.id, code],
  );
  if (!row) {
    throw notFound(`O marco ${code} não existe no projeto ${project.code}.`);
  }
  return getMilestoneDetail(t, row.id);
}
