import { z } from "zod";
import { authorize } from "@/lib/authorize";
import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound, unprocessable } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import {
  ACTOR_NAME_SQL,
  ActorRef,
  actorRef,
  authorizeProjectId,
  iso,
  isoOrNull,
  MilestoneCode,
  ProjectCode,
  projectScopeSql,
  resolveProject,
  Line,
  Timestamp,
  Uuid,
} from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";
import { emitEvent } from "@/modules/events";
import { notifyOwners, notifyProfile } from "@/modules/notifications";

/** Tipos que um agente ou pessoa pode pedir diretamente (PRD §8.4, hub_request_approval). */
export const RequestableType = z.enum([
  "milestone_acceptance",
  "milestone_proposal",
  "replan",
  "scope_change",
  "client_visibility",
  "external_message",
  "custom",
]);

export const ApprovalType = z.enum([
  "status_report",
  "milestone_acceptance",
  "milestone_proposal",
  "replan",
  "scope_change",
  "client_visibility",
  "external_message",
  "agent_key",
  "import_review",
  "custom",
]);
export const ApprovalStatus = z.enum([
  "pending",
  "approved",
  "rejected",
  "adjust_requested",
  "cancelled",
]);

export const RequestApprovalInput = z.strictObject({
  type: RequestableType,
  project: ProjectCode,
  title: Line(300),
  summary: z.string().trim().max(4000).optional(),
  milestone: MilestoneCode.optional().describe(
    "Obrigatório para milestone_acceptance: o marco cujo aceite é pedido.",
  ),
  workstream_id: Uuid.optional().describe(
    "Obrigatório para client_visibility: a frente que passaria a aparecer ao cliente.",
  ),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Detalhes da proposta. client_visibility: title_client e description_client. milestone_proposal: title, due_date e acceptance_criteria.",
    ),
  due_at: z.iso.datetime({ offset: true }).optional(),
});
export type RequestApprovalInput = z.infer<typeof RequestApprovalInput>;

export const DecideApprovalInput = z.strictObject({
  decision: z.enum(["approved", "rejected", "adjust_requested"]),
  note: z.string().trim().max(4000).optional(),
});

export const ApprovalFilter = z.strictObject({
  status: ApprovalStatus.optional(),
  project: ProjectCode.optional(),
  mine: z
    .boolean()
    .optional()
    .describe("Só os pedidos feitos por quem consulta."),
});
export type ApprovalFilter = z.infer<typeof ApprovalFilter>;

export const ApprovalDto = z.object({
  id: Uuid,
  type: ApprovalType,
  status: ApprovalStatus,
  project_code: ProjectCode.nullable(),
  entity_type: z.string().nullable(),
  entity_id: Uuid.nullable(),
  title: z.string(),
  summary: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  requested_by: ActorRef,
  acting_role: z.string().nullable(),
  approver: ActorRef.nullable(),
  due_at: Timestamp.nullable(),
  decision_note: z.string().nullable(),
  decided_by: ActorRef.nullable(),
  decided_at: Timestamp.nullable(),
  effect: z.record(z.string(), z.unknown()),
  created_at: Timestamp,
  updated_at: Timestamp,
});
export type ApprovalDto = z.infer<typeof ApprovalDto>;
export const ApprovalList = z.object({ items: z.array(ApprovalDto) });

const APPROVAL_SELECT = `
  select a.id, a.type, a.status, p.code as project_code, a.project_id, a.entity_type, a.entity_id,
         a.title, a.summary, a.payload, a.requested_by_type, a.requested_by_id,
         ${ACTOR_NAME_SQL("a.requested_by_type", "a.requested_by_id")} as requested_by_name,
         a.acting_role, a.approver_profile_id,
         (select pr.full_name from ${S}.profiles pr where pr.id = a.approver_profile_id) as approver_name,
         a.due_at, a.decision_note, a.decided_by_profile_id,
         (select pr.full_name from ${S}.profiles pr where pr.id = a.decided_by_profile_id) as decided_by_name,
         a.decided_at, a.effect, a.created_at, a.updated_at
    from ${S}.approvals a
    left join ${S}.projects p on p.id = a.project_id`;

type ApprovalRow = {
  id: string;
  type: ApprovalDto["type"];
  status: ApprovalDto["status"];
  project_code: string | null;
  project_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
  requested_by_type: string;
  requested_by_id: string | null;
  requested_by_name: string | null;
  acting_role: string | null;
  approver_profile_id: string | null;
  approver_name: string | null;
  due_at: Date | string | null;
  decision_note: string | null;
  decided_by_profile_id: string | null;
  decided_by_name: string | null;
  decided_at: Date | string | null;
  effect: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
};

export function toApprovalDto(r: ApprovalRow): ApprovalDto {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    project_code: r.project_code,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    title: r.title,
    summary: r.summary,
    payload: r.payload ?? {},
    requested_by: actorRef(
      r.requested_by_type,
      r.requested_by_id,
      r.requested_by_name,
    )!,
    acting_role: r.acting_role,
    approver: r.approver_profile_id
      ? actorRef("user", r.approver_profile_id, r.approver_name)
      : null,
    due_at: isoOrNull(r.due_at),
    decision_note: r.decision_note,
    decided_by: r.decided_by_profile_id
      ? actorRef("user", r.decided_by_profile_id, r.decided_by_name)
      : null,
    decided_at: isoOrNull(r.decided_at),
    effect: r.effect ?? {},
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export async function approvalById(t: TxCtx, id: string): Promise<ApprovalDto> {
  const row = await maybeOne<ApprovalRow>(
    t,
    `${APPROVAL_SELECT} where a.id = $1`,
    [id],
  );
  if (!row) throw notFound("Aprovação não encontrada neste workspace.");
  return toApprovalDto(row);
}

/** Detalhe de um pedido: quem pediu sempre vê; os demais, pelo escopo do projeto. */
export async function getApproval(t: TxCtx, id: string): Promise<ApprovalDto> {
  const row = await maybeOne<ApprovalRow>(
    t,
    `${APPROVAL_SELECT} where a.id = $1`,
    [id],
  );
  if (!row) throw notFound("Aprovação não encontrada neste workspace.");
  const mine =
    row.requested_by_id !== null && row.requested_by_id === t.actor.id;
  if (!mine) {
    if (row.project_id)
      await authorizeProjectId(t, row.project_id, "approval.read");
    else authorize(t.actor, "approval.read");
  }
  return toApprovalDto(row);
}

async function ownerProfileId(t: TxCtx): Promise<string | null> {
  return (
    (
      await maybeOne<{ profile_id: string }>(
        t,
        `select profile_id from ${S}.memberships
          where role = 'owner' and status = 'active'
          order by created_at limit 1`,
      )
    )?.profile_id ?? null
  );
}

/**
 * Abre um pedido de decisão humana. Agentes só pedem; quem decide é uma pessoa, pela
 * interface (PRD RF-26). Mesmo pedido pendente para o mesmo item vira conflito.
 */
export async function requestApproval(
  t: TxCtx,
  input: RequestApprovalInput,
): Promise<ApprovalDto> {
  const project = await resolveProject(t, input.project, "approval.request");
  assertNoSecrets({ title: input.title, summary: input.summary });
  const payload = input.payload ?? {};
  assertNoSecrets(
    Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [
        k,
        typeof v === "string" ? v : JSON.stringify(v),
      ]),
    ),
  );

  let entity: { type: string; id: string } | null = null;
  if (input.type === "milestone_acceptance") {
    if (!input.milestone) {
      throw badRequest(
        "Para pedir aceite de marco, informe milestone (por exemplo, M2).",
      );
    }
    const m = await maybeOne<{ id: string; status: string }>(
      t,
      `select id, status from ${S}.milestones where project_id = $1 and code = $2 and archived_at is null`,
      [project.id, input.milestone],
    );
    if (!m)
      throw unprocessable(
        `O marco ${input.milestone} não existe no projeto ${project.code}.`,
      );
    if (m.status === "accepted")
      throw conflict(`O marco ${input.milestone} já foi aceito.`);
    entity = { type: "milestone", id: m.id };
  } else if (input.type === "client_visibility") {
    if (!input.workstream_id) {
      throw badRequest(
        "Para mostrar uma frente ao cliente, informe workstream_id.",
      );
    }
    const titleClient = payload.title_client;
    if (
      typeof titleClient !== "string" ||
      titleClient.trim().length === 0 ||
      titleClient.length > 200
    ) {
      throw badRequest(
        "Envie em payload.title_client o título escrito para o cliente (até 200 caracteres); payload.description_client é opcional.",
      );
    }
    const w = await maybeOne<{ id: string; visibility: string }>(
      t,
      `select id, visibility from ${S}.workstreams where id = $1 and project_id = $2`,
      [input.workstream_id, project.id],
    );
    if (!w)
      throw unprocessable("A frente indicada não pertence a este projeto.");
    if (w.visibility === "client")
      throw conflict("Esta frente já aparece para o cliente.");
    entity = { type: "workstream", id: w.id };
  } else if (input.type === "milestone_proposal") {
    if (
      typeof payload.title !== "string" ||
      payload.title.trim().length === 0
    ) {
      throw badRequest("Envie em payload.title o título do marco proposto.");
    }
  }

  if (entity) {
    const pending = await maybeOne<{ id: string }>(
      t,
      `select id from ${S}.approvals
        where type = $1 and entity_id = $2 and status = 'pending'`,
      [input.type, entity.id],
    );
    if (pending) {
      throw conflict("Já existe um pedido pendente igual para este item.", {
        approval_id: pending.id,
      });
    }
  }

  const inserted = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.approvals
       (workspace_id, project_id, type, entity_type, entity_id, title, summary, payload,
        requested_by_type, requested_by_id, acting_role, approver_profile_id, due_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
     returning id`,
    [
      t.actor.workspaceId,
      project.id,
      input.type,
      entity?.type ?? null,
      entity?.id ?? null,
      input.title,
      input.summary ?? null,
      json(payload),
      t.actor.type,
      t.actor.id,
      t.actor.actingRole ?? null,
      await ownerProfileId(t),
      input.due_at ?? null,
    ],
  );
  const dto = await approvalById(t, inserted!.id);
  await notifyOwners(
    t,
    "approval.requested",
    { type: "approval", id: dto.id },
    {
      title: dto.title,
      type: dto.type,
      project_code: dto.project_code,
    },
  );
  await audit(t, {
    action: "approval.requested",
    entityType: "approval",
    entityId: dto.id,
    projectId: project.id,
    after: {
      type: dto.type,
      title: dto.title,
      entity_type: dto.entity_type,
      entity_id: dto.entity_id,
    },
  });
  await emitEvent(t, "approval.requested", {
    id: dto.id,
    type: dto.type,
    project_code: dto.project_code,
    title: dto.title,
  });
  return dto;
}

export async function listApprovals(
  t: TxCtx,
  filter: ApprovalFilter,
): Promise<{ items: ApprovalDto[] }> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filter.project) {
    const project = await resolveProject(t, filter.project, "approval.read");
    params.push(project.id);
    where.push(`a.project_id = $${params.length}`);
  } else {
    authorize(t.actor, "approval.read");
  }
  // Fora do escopo de projetos do ator, só os pedidos que ele mesmo fez.
  let mineRef: string | null = null;
  const mine = () => {
    if (!mineRef) {
      params.push(t.actor.id);
      mineRef = `$${params.length}::uuid`;
    }
    return mineRef;
  };
  const scope = projectScopeSql(t.actor, "a.project_id", params);
  if (scope !== "true") {
    where.push(
      `(a.requested_by_id = ${mine()} or (a.project_id is not null and ${scope}))`,
    );
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`a.status::text = $${params.length}`);
  }
  if (filter.mine) where.push(`a.requested_by_id = ${mine()}`);
  const rows = await many<ApprovalRow>(
    t,
    `${APPROVAL_SELECT} where ${where.length ? where.join(" and ") : "true"}
     order by a.created_at desc, a.id desc
     limit 200`,
    params,
  );
  return { items: rows.map(toApprovalDto) };
}

/**
 * Decisão humana sobre um pedido (owner, D9). Ao aprovar, aplica o efeito do tipo:
 * aceite de marco, frente visível ao cliente, relatório publicado, projeto importado ativo.
 */
export async function decideApproval(
  t: TxCtx,
  id: string,
  input: {
    decision: "approved" | "rejected" | "adjust_requested";
    note?: string;
  },
): Promise<ApprovalDto> {
  const row = await maybeOne<{
    id: string;
    type: ApprovalDto["type"];
    status: string;
    project_id: string | null;
    entity_type: string | null;
    entity_id: string | null;
    payload: Record<string, unknown>;
    requested_by_type: string;
    requested_by_id: string | null;
  }>(
    t,
    `select id, type, status, project_id, entity_type, entity_id, payload,
            requested_by_type, requested_by_id
       from ${S}.approvals where id = $1 for update`,
    [id],
  );
  if (!row) throw notFound("Aprovação não encontrada neste workspace.");
  if (row.project_id) {
    await authorizeProjectId(t, row.project_id, "approval.decide");
  } else {
    authorize(t.actor, "approval.decide");
  }
  if (row.status !== "pending") {
    throw conflict("Este pedido já foi decidido ou cancelado.");
  }

  await t.tx.query(
    `update ${S}.approvals
        set status = $2, decision_note = $3, decided_by_profile_id = $4, decided_at = now()
      where id = $1`,
    [row.id, input.decision, input.note ?? null, t.actor.id],
  );

  let effect: Record<string, unknown> = { applied: false };
  if (input.decision === "approved") {
    effect = await applyEffect(t, row);
    await t.tx.query(
      `update ${S}.approvals set effect = $2::jsonb where id = $1`,
      [row.id, json(effect)],
    );
  }

  const dto = await approvalById(t, row.id);
  if (row.requested_by_type === "user" && row.requested_by_id) {
    await notifyProfile(
      t,
      row.requested_by_id,
      "approval.decided",
      { type: "approval", id: dto.id },
      {
        title: dto.title,
        decision: dto.status,
      },
    );
  }
  await audit(t, {
    action: "approval.decided",
    entityType: "approval",
    entityId: dto.id,
    projectId: row.project_id,
    before: { status: "pending" },
    after: { status: dto.status, note: dto.decision_note, effect },
  });
  await emitEvent(t, "approval.decided", {
    id: dto.id,
    type: dto.type,
    status: dto.status,
    project_code: dto.project_code,
  });
  return dto;
}

async function applyEffect(
  t: TxCtx,
  row: {
    type: ApprovalDto["type"];
    project_id: string | null;
    entity_id: string | null;
    payload: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  switch (row.type) {
    case "milestone_acceptance": {
      const m = await maybeOne<{ code: string }>(
        t,
        `update ${S}.milestones
            set status = 'accepted', accepted_at = now(), accepted_by_profile_id = $2,
                delivered_at = coalesce(delivered_at, now())
          where id = $1
          returning code`,
        [row.entity_id, t.actor.id],
      );
      if (m) {
        await emitEvent(t, "milestone.status_changed", {
          milestone: m.code,
          status: "accepted",
        });
      }
      return { applied: Boolean(m), milestone_status: "accepted" };
    }
    case "client_visibility": {
      const title = String(row.payload.title_client ?? "").trim();
      const description =
        typeof row.payload.description_client === "string"
          ? row.payload.description_client.trim().slice(0, 2000)
          : null;
      await t.tx.query(
        `update ${S}.workstreams
            set visibility = 'client', title_client = $2, description_client = $3
          where id = $1`,
        [row.entity_id, title.slice(0, 200), description],
      );
      return { applied: true, workstream_visibility: "client" };
    }
    case "status_report": {
      await t.tx.query(
        `update ${S}.status_reports set published_at = now() where id = $1 and published_at is null`,
        [row.entity_id],
      );
      await emitEvent(t, "report.published", { report_id: row.entity_id });
      return { applied: true, report_published: true };
    }
    case "import_review": {
      const next =
        typeof row.payload.next_status === "string" &&
        ["discovery", "active", "paused"].includes(row.payload.next_status)
          ? row.payload.next_status
          : "active";
      await t.tx.query(
        `update ${S}.projects set status = $2 where id = $1 and status = 'in_review'`,
        [row.project_id, next],
      );
      return { applied: true, project_status: next };
    }
    default:
      return {
        applied: false,
        note: "Sem efeito automático neste tipo: a decisão fica registrada para quem pediu.",
      };
  }
}
