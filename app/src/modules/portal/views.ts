import { forbidden, notFound } from "@/lib/errors";
import type { Actor } from "@/lib/db/actor";
import { iso } from "@/modules/common";
import {
  CHANNEL_SQL,
  toMessage,
  type ChannelMessage,
} from "@/modules/comments/client-channel";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Leituras do portal do cliente (D9). Rodam com o ator de cliente: a RLS só devolve os
 * projetos do cliente (fora de revisão e não arquivados) e os marcos marcados para ele.
 * Cada leitura escolhe os campos um a um (DTO do portal): nada de campo interno, nem
 * texto interno no lugar do texto para o cliente.
 */

export function assertClient(actor: Actor): void {
  if (actor.scope !== "client") {
    throw forbidden("Esta leitura é só do portal do cliente.");
  }
}

export type PortalProject = {
  code: string;
  name: string;
  phase: "descobrir" | "validar" | "escalar";
  objective: string | null;
  progressPct: number;
  targetDate: string | null;
  nextMilestone: { title: string; dueDate: string | null } | null;
};

type ProjectRow = {
  id: string;
  code: string;
  name: string;
  phase: PortalProject["phase"];
  objective_client: string | null;
  progress_pct: number;
  target_date: string | null;
};

type MilestoneRow = {
  project_id: string;
  title_client: string | null;
  due_date: string | null;
};

/** Os projetos do cliente, com o próximo marco para ele (o primeiro ainda não entregue). */
export async function portalProjects(t: TxCtx): Promise<PortalProject[]> {
  assertClient(t.actor);
  const projects = await many<ProjectRow>(
    t,
    `select p.id, p.code, p.name, p.phase::text as phase, p.objective_client,
            p.progress_pct, p.target_date::text as target_date
       from ${S}.projects p
      order by p.name`,
  );
  if (projects.length === 0) return [];
  const next = await many<MilestoneRow>(
    t,
    `select distinct on (m.project_id) m.project_id, m.title_client,
            m.due_date::text as due_date
       from ${S}.milestones m
      where m.project_id = any($1::uuid[])
        and m.status not in ('delivered', 'accepted')
        and m.title_client is not null
      order by m.project_id, m.sort_order, m.code`,
    [projects.map((p) => p.id)],
  );
  return projects.map((p) => {
    const m = next.find((n) => n.project_id === p.id);
    return {
      code: p.code,
      name: p.name,
      phase: p.phase,
      objective: p.objective_client,
      progressPct: Number(p.progress_pct),
      targetDate: p.target_date,
      nextMilestone: m?.title_client
        ? { title: m.title_client, dueDate: m.due_date }
        : null,
    };
  });
}

// Página do projeto ---------------------------------------------------------------------

/** Estado do marco para o cliente: o aceite é do dono (D9); para o cliente, é "concluída". */
export type PortalMilestoneStatus =
  "planned" | "in_progress" | "delivered" | "accepted";

/** Frente marcada para o cliente: o texto para ele e o andamento (PRD §9), sem o estado. */
export type PortalWorkstream = {
  title: string;
  description: string | null;
  progressPct: number;
};

export type PortalMilestone = {
  /** Id do marco, só para o formulário de confirmar o recebimento. */
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  /** Quantas vezes a data foi revista (nunca o motivo, que é interno: RF-11). */
  revisions: number;
  status: PortalMilestoneStatus;
  /** Quando foi entregue (ou concluída), para "Entregue em". */
  deliveredAt: string | null;
  /** O cliente confirmou que recebeu (opção do projeto): quando e quem. */
  receivedAt: string | null;
  receivedBy: string | null;
  workstreams: PortalWorkstream[];
};

export type PortalReport = {
  periodStart: string;
  periodEnd: string;
  publishedAt: string;
  bodyMd: string;
};

export type PortalProjectDetail = PortalProject & {
  /** O projeto deixa o cliente decisor confirmar o recebimento das entregas (D9). */
  clientCanConfirm: boolean;
  milestones: PortalMilestone[];
  /** Frentes marcadas para o cliente sem um marco que ele veja. */
  otherWorkstreams: PortalWorkstream[];
  reports: PortalReport[];
};

type DetailMilestoneRow = {
  id: string;
  title_client: string;
  description_client: string | null;
  due_date: string | null;
  status: PortalMilestoneStatus;
  delivered_at: Date | string | null;
  accepted_at: Date | string | null;
  client_received_at: Date | string | null;
  client_received_by_name: string | null;
};

type DetailWorkstreamRow = {
  milestone_id: string | null;
  title_client: string | null;
  description_client: string | null;
  progress_pct: number;
};

type ReportRow = {
  period_start: string;
  period_end: string;
  published_at: Date | string;
  body_md: string;
};

/**
 * Um projeto do cliente, com os marcos (texto para o cliente, data vigente, quantas vezes
 * foi revista e o estado), as frentes marcadas para ele com o andamento e os relatórios
 * publicados. Projeto de outro cliente, em revisão ou arquivado: 404, como se não
 * existisse.
 */
export async function portalProject(
  t: TxCtx,
  code: string,
): Promise<PortalProjectDetail> {
  assertClient(t.actor);
  const project = await maybeOne<
    ProjectRow & { client_can_confirm_receipt: boolean }
  >(
    t,
    `select p.id, p.code, p.name, p.phase::text as phase, p.objective_client,
            p.progress_pct, p.target_date::text as target_date,
            p.client_can_confirm_receipt
       from ${S}.projects p
      where p.code = $1`,
    [code],
  );
  if (!project) throw notFound("Projeto não encontrado.");

  const milestoneRows = await many<DetailMilestoneRow>(
    t,
    `select m.id, m.title_client, m.description_client, m.due_date::text as due_date,
            m.status::text as status, m.delivered_at, m.accepted_at,
            m.client_received_at, m.client_received_by_name
       from ${S}.milestones m
      where m.project_id = $1 and m.title_client is not null
      order by m.sort_order, m.code`,
    [project.id],
  );
  const revisions = new Map(
    (
      await many<{ milestone_id: string; revisions: number }>(
        t,
        `select milestone_id, revisions
           from ${S}.client_milestone_revisions($1)`,
        [project.id],
      )
    ).map((r) => [r.milestone_id, Number(r.revisions)]),
  );
  const workstreamRows = await many<DetailWorkstreamRow>(
    t,
    `select w.milestone_id, w.title_client, w.description_client, w.progress_pct
       from ${S}.workstreams w
      where w.project_id = $1 and w.title_client is not null
      order by w.sort_order, w.created_at`,
    [project.id],
  );
  const reports = await many<ReportRow>(
    t,
    `select r.period_start::text as period_start, r.period_end::text as period_end,
            r.published_at, r.body_md
       from ${S}.status_reports r
      where r.project_id = $1
      order by r.published_at desc
      limit 24`,
    [project.id],
  );

  const toWorkstream = (w: DetailWorkstreamRow): PortalWorkstream => ({
    title: w.title_client ?? "",
    description: w.description_client,
    progressPct: Number(w.progress_pct),
  });
  const shown = new Set(milestoneRows.map((m) => m.id));
  const milestones = milestoneRows.map((m) => ({
    id: m.id,
    title: m.title_client,
    description: m.description_client,
    dueDate: m.due_date,
    revisions: revisions.get(m.id) ?? 0,
    status: m.status,
    deliveredAt:
      (m.status === "delivered" || m.status === "accepted") &&
      (m.delivered_at ?? m.accepted_at)
        ? iso(m.delivered_at ?? m.accepted_at)
        : null,
    receivedAt: m.client_received_at ? iso(m.client_received_at) : null,
    receivedBy: m.client_received_by_name,
    workstreams: workstreamRows
      .filter((w) => w.milestone_id === m.id)
      .map(toWorkstream),
  }));
  const next = milestones.find(
    (m) => m.status !== "delivered" && m.status !== "accepted",
  );
  return {
    code: project.code,
    name: project.name,
    phase: project.phase,
    objective: project.objective_client,
    progressPct: Number(project.progress_pct),
    targetDate: project.target_date,
    nextMilestone: next ? { title: next.title, dueDate: next.dueDate } : null,
    clientCanConfirm: project.client_can_confirm_receipt,
    milestones,
    otherWorkstreams: workstreamRows
      .filter((w) => !w.milestone_id || !shown.has(w.milestone_id))
      .map(toWorkstream),
    reports: reports.map((r) => ({
      periodStart: r.period_start,
      periodEnd: r.period_end,
      publishedAt: iso(r.published_at),
      bodyMd: r.body_md,
    })),
  };
}

// Conversa com a equipe ------------------------------------------------------------------

/**
 * O canal do projeto visto pelo cliente: só as mensagens do canal (a RLS já esconde o
 * resto), da mais antiga para a mais nova. Projeto que ele não vê: 404.
 */
export async function portalChannel(
  t: TxCtx,
  code: string,
): Promise<ChannelMessage[]> {
  assertClient(t.actor);
  const project = await maybeOne<{ id: string }>(
    t,
    `select p.id from ${S}.projects p where p.code = $1`,
    [code],
  );
  if (!project) throw notFound("Projeto não encontrado.");
  const rows = await many<Parameters<typeof toMessage>[0]>(t, CHANNEL_SQL, [
    project.id,
  ]);
  return rows.reverse().map(toMessage);
}

// Arquivos entregues ---------------------------------------------------------------------

export type PortalFile = {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  at: string;
};

/** Os arquivos que a equipe entregou no projeto (a RLS só mostra os do cliente). */
export async function portalFiles(
  t: TxCtx,
  code: string,
): Promise<PortalFile[]> {
  assertClient(t.actor);
  const rows = await many<{
    id: string;
    filename: string;
    mime: string;
    size_bytes: number;
    created_at: Date | string;
  }>(
    t,
    `select a.id, a.filename, a.mime, a.size_bytes::int as size_bytes, a.created_at
       from ${S}.attachments a
       join ${S}.projects p on p.id = a.project_id
      where p.code = $1 and a.entity_type = 'project'
      order by a.created_at desc, a.id desc`,
    [code],
  );
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mime: r.mime,
    sizeBytes: Number(r.size_bytes),
    at: iso(r.created_at),
  }));
}

/** O conteúdo de um arquivo entregue, para o download no portal (sob a RLS do cliente). */
export async function readPortalFile(
  t: TxCtx,
  code: string,
  id: string,
): Promise<{ filename: string; mime: string; content: Buffer }> {
  assertClient(t.actor);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw notFound("Arquivo não encontrado.");
  }
  const row = await maybeOne<{
    filename: string;
    mime: string;
    content: Uint8Array;
  }>(
    t,
    `select a.filename, a.mime, ac.content
       from ${S}.attachments a
       join ${S}.projects p on p.id = a.project_id
       join ${S}.attachment_contents ac on ac.attachment_id = a.id
      where a.id = $1 and p.code = $2 and a.entity_type = 'project'`,
    [id, code],
  );
  if (!row) throw notFound("Arquivo não encontrado.");
  return {
    filename: row.filename,
    mime: row.mime,
    content: Buffer.from(row.content),
  };
}

// Identidade -----------------------------------------------------------------------------

/**
 * A cor de destaque do cliente (cadastro do cliente), para os detalhes do portal. Só o
 * código da cor, conferido no banco (#RRGGBB); o resto do cadastro não sai daqui.
 */
export async function portalAccent(t: TxCtx): Promise<string | null> {
  assertClient(t.actor);
  const row = await maybeOne<{ accent_color: string | null }>(
    t,
    `select accent_color from ${S}.clients limit 1`,
  );
  const color = row?.accent_color ?? null;
  return color && /^#[0-9A-Fa-f]{6}$/.test(color) ? color : null;
}
