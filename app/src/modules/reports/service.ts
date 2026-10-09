import { z } from "zod";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import {
  iso,
  IsoDate,
  isoOrNull,
  ProjectCode,
  resolveProject,
  Text,
  Timestamp,
  Uuid,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { approvalById, ApprovalDto } from "@/modules/approvals/service";
import { emitEvent } from "@/modules/events";
import { notifyOwners } from "@/modules/notifications";

export const DraftReportInput = z.strictObject({
  project: ProjectCode,
  period_start: IsoDate,
  period_end: IsoDate,
  audience: z.enum(["internal", "client"]),
  body_md: Text(20000).describe(
    "Para o cliente: segunda pessoa, linguagem de resultado, sem jargão interno, sem nomes de ferramentas e sem valores.",
  ),
});
export type DraftReportInput = z.infer<typeof DraftReportInput>;

export const ReportDto = z.object({
  id: Uuid,
  project_code: ProjectCode,
  period_start: IsoDate,
  period_end: IsoDate,
  audience: z.enum(["internal", "client"]),
  body_md: z.string(),
  approval_id: Uuid.nullable(),
  published_at: Timestamp.nullable(),
  version: z.number().int(),
  created_at: Timestamp,
});
export type ReportDto = z.infer<typeof ReportDto>;

export const DraftReportResult = z.object({
  report: ReportDto,
  approval: ApprovalDto,
});

type ReportRow = {
  id: string;
  project_code: string;
  period_start: string;
  period_end: string;
  audience: ReportDto["audience"];
  body_md: string;
  approval_id: string | null;
  published_at: Date | string | null;
  version: number;
  created_at: Date | string;
};

const REPORT_SELECT = `
  select r.id, p.code as project_code, r.period_start, r.period_end, r.audience, r.body_md,
         r.approval_id, r.published_at, r.version, r.created_at
    from ${S}.status_reports r
    join ${S}.projects p on p.id = r.project_id`;

function toReportDto(r: ReportRow): ReportDto {
  return {
    id: r.id,
    project_code: r.project_code,
    period_start: r.period_start,
    period_end: r.period_end,
    audience: r.audience,
    body_md: r.body_md,
    approval_id: r.approval_id,
    published_at: isoOrNull(r.published_at),
    version: r.version,
    created_at: iso(r.created_at),
  };
}

/**
 * Rascunho de status (RF-34). Vira aprovação pendente; só com o "sim" do Fábio o Hub
 * publica (efeito da aprovação). Nada sai para o cliente sem decisão humana.
 */
export async function draftReport(
  t: TxCtx,
  input: DraftReportInput,
): Promise<{ report: ReportDto; approval: ApprovalDto }> {
  const project = await resolveProject(t, input.project, "report.draft");
  if (input.period_end < input.period_start) {
    throw badRequest("O fim do período não pode ser anterior ao início.");
  }
  assertNoSecrets({ body_md: input.body_md });
  const version =
    ((
      await maybeOne<{ v: number }>(
        t,
        `select max(version) as v from ${S}.status_reports
          where project_id = $1 and period_start = $2 and period_end = $3 and audience = $4`,
        [project.id, input.period_start, input.period_end, input.audience],
      )
    )?.v ?? 0) + 1;
  const report = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.status_reports
       (workspace_id, project_id, period_start, period_end, audience, body_md,
        generated_by_agent_id, version)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      t.actor.workspaceId,
      project.id,
      input.period_start,
      input.period_end,
      input.audience,
      input.body_md,
      t.actor.type === "agent" ? t.actor.id : null,
      version,
    ],
  );
  const owner = await maybeOne<{ profile_id: string }>(
    t,
    `select profile_id from ${S}.memberships where role = 'owner' and status = 'active'
      order by created_at limit 1`,
  );
  const audienceLabel = input.audience === "client" ? "cliente" : "interno";
  const approval = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.approvals
       (workspace_id, project_id, type, entity_type, entity_id, title, summary,
        requested_by_type, requested_by_id, acting_role, approver_profile_id)
     values ($1, $2, 'status_report', 'report', $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      t.actor.workspaceId,
      project.id,
      report!.id,
      `Status ${audienceLabel} de ${project.code}: ${input.period_start} a ${input.period_end}`,
      `Rascunho versão ${version}. Aprovar publica o relatório${input.audience === "client" ? " no portal do cliente" : ""}.`,
      t.actor.type,
      t.actor.id,
      t.actor.actingRole ?? null,
      owner?.profile_id ?? null,
    ],
  );
  await t.tx.query(
    `update ${S}.status_reports set approval_id = $2 where id = $1`,
    [report!.id, approval!.id],
  );
  const dto = toReportDto(
    (await maybeOne<ReportRow>(t, `${REPORT_SELECT} where r.id = $1`, [
      report!.id,
    ]))!,
  );
  const approvalDto = await approvalById(t, approval!.id);
  await notifyOwners(
    t,
    "approval.requested",
    { type: "approval", id: approvalDto.id },
    {
      title: approvalDto.title,
      type: "status_report",
      project_code: project.code,
    },
  );
  await audit(t, {
    action: "report.drafted",
    entityType: "report",
    entityId: dto.id,
    projectId: project.id,
    after: {
      audience: dto.audience,
      version: dto.version,
      approval_id: approvalDto.id,
    },
  });
  await emitEvent(t, "approval.requested", {
    id: approvalDto.id,
    type: "status_report",
    project_code: project.code,
    title: approvalDto.title,
  });
  return { report: dto, approval: approvalDto };
}

export async function listReports(
  t: TxCtx,
  projectCode: string,
): Promise<{ items: ReportDto[] }> {
  const project = await resolveProject(t, projectCode, "report.read");
  const rows = await many<ReportRow>(
    t,
    `${REPORT_SELECT} where r.project_id = $1
      order by r.period_end desc, r.version desc
      limit 100`,
    [project.id],
  );
  return { items: rows.map(toReportDto) };
}
