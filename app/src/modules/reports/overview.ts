import { authorize } from "@/lib/authorize";
import { ACTOR_NAME_SQL, iso, ProjectCode } from "@/modules/common";
import { many, S, type TxCtx } from "@/modules/context";

/**
 * Tela Relatórios (M6): os relatórios de status de cada projeto, com todas as versões
 * guardadas e a situação de cada uma. Um relatório é o conjunto de versões de um projeto,
 * audiência e período; a versão nova (de quem preparou ou do Redator do Cliente, RC-12)
 * substitui a anterior, e só a aprovada é publicada.
 */

export type ReportState =
  "published" | "pending" | "superseded" | "rejected" | "adjust" | "draft";

export type ReportVersion = {
  id: string;
  version: number;
  bodyMd: string;
  createdAt: string;
  publishedAt: string | null;
  /** Quem preparou: o agente (ou pessoa, sem agente). */
  author: string | null;
  state: ReportState;
  approvalId: string | null;
};

export type ReportGroup = {
  projectCode: string;
  projectName: string;
  audience: "client" | "internal";
  periodStart: string;
  periodEnd: string;
  versions: ReportVersion[];
};

type Row = {
  id: string;
  project_code: string;
  project_name: string;
  audience: "client" | "internal";
  period_start: string;
  period_end: string;
  version: number;
  body_md: string;
  created_at: Date | string;
  published_at: Date | string | null;
  author: string | null;
  approval_id: string | null;
  approval_status: string | null;
  approval_entity: string | null;
};

/** Situação de uma versão, pela publicação e pelo pedido de aprovação dela. */
export function versionState(r: {
  id: string;
  published_at: unknown;
  approval_id: string | null;
  approval_status: string | null;
  approval_entity: string | null;
}): ReportState {
  if (r.published_at) return "published";
  if (!r.approval_id || !r.approval_status) return "draft";
  // O pedido passou a apontar para outra versão (a do Redator do Cliente).
  if (r.approval_entity && r.approval_entity !== r.id) return "superseded";
  switch (r.approval_status) {
    case "pending":
      return "pending";
    case "cancelled":
      return "superseded";
    case "rejected":
      return "rejected";
    case "adjust_requested":
      return "adjust";
    default:
      return "draft";
  }
}

export async function reportsOverview(
  t: TxCtx,
  filter: {
    project?: string | null;
    audience?: "client" | "internal" | null;
  } = {},
): Promise<ReportGroup[]> {
  authorize(t.actor, "report.read");
  const project =
    filter.project && ProjectCode.safeParse(filter.project).success
      ? filter.project
      : null;
  // Pessoa da equipe comum vê os relatórios dos projetos de que participa.
  const member =
    t.actor.type === "user" &&
    t.actor.scope === "internal" &&
    t.actor.role === "member"
      ? t.actor.id
      : null;
  const rows = await many<Row>(
    t,
    `select r.id, p.code as project_code, p.name as project_name,
            r.audience::text as audience, r.period_start::text as period_start,
            r.period_end::text as period_end, r.version, r.body_md, r.created_at,
            r.published_at,
            coalesce(ag.name, ${ACTOR_NAME_SQL("a.requested_by_type::text", "a.requested_by_id")}) as author,
            r.approval_id,
            a.status::text as approval_status, a.entity_id as approval_entity
       from ${S}.status_reports r
       join ${S}.projects p on p.id = r.project_id
       left join ${S}.agents ag on ag.id = r.generated_by_agent_id
       left join ${S}.approvals a on a.id = r.approval_id
      where ($1::text is null or p.code = $1)
        and ($2::text is null or r.audience::text = $2)
        and ($3::uuid is null or exists (
              select 1 from ${S}.project_members pm
               where pm.project_id = p.id and pm.profile_id = $3))
      order by r.period_end desc, p.name, r.audience, r.version desc
      limit 400`,
    [project, filter.audience ?? null, member],
  );
  const groups = new Map<string, ReportGroup>();
  for (const r of rows) {
    const key = `${r.project_code}|${r.audience}|${r.period_start}|${r.period_end}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        projectCode: r.project_code,
        projectName: r.project_name,
        audience: r.audience,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        versions: [],
      };
      groups.set(key, group);
    }
    group.versions.push({
      id: r.id,
      version: r.version,
      bodyMd: r.body_md,
      createdAt: iso(r.created_at),
      publishedAt: r.published_at ? iso(r.published_at) : null,
      author: r.author,
      state: versionState(r),
      approvalId: r.approval_id,
    });
  }
  return [...groups.values()];
}
