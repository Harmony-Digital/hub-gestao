import { notFound } from "@/lib/errors";
import {
  actorRef,
  authorizeProjectId,
  isoOrNull,
  resolveProject,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import type { MilestoneDto } from "@/modules/projects/schemas";

export const MILESTONE_SELECT = `
  select m.id, p.code as project_code, m.project_id, m.code, m.title, m.title_client,
         m.description_client, m.due_date, m.sort_order, m.gate_required, m.status,
         coalesce(m.status in ('planned', 'in_progress') and m.due_date < current_date, false) as late,
         m.visibility, m.acceptance_criteria, m.progress_pct, m.task_count, m.done_count,
         m.delivered_at, m.accepted_at, m.accepted_by_profile_id,
         (select pr.full_name from ${S}.profiles pr where pr.id = m.accepted_by_profile_id) as accepted_by_name,
         m.client_received_at, m.client_received_by_name
    from ${S}.milestones m
    join ${S}.projects p on p.id = m.project_id`;

export type MilestoneRow = {
  id: string;
  project_code: string;
  project_id: string;
  code: string;
  title: string;
  title_client: string | null;
  description_client: string | null;
  due_date: string | null;
  sort_order: number;
  gate_required: boolean;
  status: MilestoneDto["status"];
  late: boolean;
  visibility: MilestoneDto["visibility"];
  acceptance_criteria: unknown;
  progress_pct: number;
  task_count: number;
  done_count: number;
  delivered_at: Date | string | null;
  accepted_at: Date | string | null;
  accepted_by_profile_id: string | null;
  accepted_by_name: string | null;
  client_received_at: Date | string | null;
  client_received_by_name: string | null;
};

/** Critérios de aceite como lista de { text, done }, aceitando texto simples. */
export function normalizeCriteria(
  value: unknown,
): MilestoneDto["acceptance_criteria"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [{ text: item, done: false }];
    if (item && typeof item === "object" && "text" in item) {
      const { text, done } = item as { text: unknown; done?: unknown };
      return typeof text === "string" ? [{ text, done: done === true }] : [];
    }
    return [];
  });
}

export function toMilestoneDto(r: MilestoneRow): MilestoneDto {
  return {
    id: r.id,
    project_code: r.project_code,
    code: r.code,
    title: r.title,
    title_client: r.title_client,
    description_client: r.description_client,
    due_date: r.due_date,
    sort_order: r.sort_order,
    gate_required: r.gate_required,
    status: r.status,
    late: r.late,
    visibility: r.visibility,
    acceptance_criteria: normalizeCriteria(r.acceptance_criteria),
    progress_pct: r.progress_pct,
    task_count: r.task_count,
    done_count: r.done_count,
    delivered_at: isoOrNull(r.delivered_at),
    accepted_at: isoOrNull(r.accepted_at),
    accepted_by: r.accepted_by_profile_id
      ? actorRef("user", r.accepted_by_profile_id, r.accepted_by_name)
      : null,
    client_received_at: isoOrNull(r.client_received_at),
    client_received_by: r.client_received_by_name,
  };
}

export async function milestonesOfProject(
  t: TxCtx,
  projectId: string,
): Promise<MilestoneDto[]> {
  const rows = await many<MilestoneRow>(
    t,
    `${MILESTONE_SELECT}
      where m.project_id = $1 and m.archived_at is null
      order by m.sort_order, m.code`,
    [projectId],
  );
  return rows.map(toMilestoneDto);
}

export async function listMilestones(
  t: TxCtx,
  projectCode: string,
): Promise<{ items: MilestoneDto[] }> {
  const project = await resolveProject(t, projectCode, "milestone.read");
  return { items: await milestonesOfProject(t, project.id) };
}

export async function getMilestone(
  t: TxCtx,
  id: string,
): Promise<MilestoneDto> {
  const row = await maybeOne<MilestoneRow>(
    t,
    `${MILESTONE_SELECT} where m.id = $1`,
    [id],
  );
  if (!row) throw notFound("Marco não encontrado neste workspace.");
  await authorizeProjectId(t, row.project_id, "milestone.read");
  return toMilestoneDto(row);
}
