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
import { attempt } from "@/modules/attempt";
import { checkProjectClientTexts } from "@/modules/client-text/context";
import { enqueueClientRewrite } from "@/modules/client-text/writer";
import { enqueueReportEmail } from "@/modules/reports/email";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";
import { emitEvent } from "@/modules/events";
import { notifyOwners, notifyProfile } from "@/modules/notifications";
import { revokeAgentKey } from "@/modules/agents/service";
import {
  applyProposal,
  isProposal,
  prepareProposal,
  PROPOSAL_HELP,
} from "./proposals";

/** Tipos que um agente ou pessoa pode pedir diretamente (PRD §8.4, hub_request_approval). */
export const RequestableType = z.enum([
  "milestone_acceptance",
  "milestone_proposal",
  "replan",
  "scope_change",
  "client_visibility",
  "external_message",
  "agent_key",
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
  project: ProjectCode.optional().describe(
    "Código do projeto (ex.: HUB). Obrigatório, menos no agent_key: a chave de um agente não é de um projeto.",
  ),
  title: Line(300),
  summary: z.string().trim().max(4000).optional(),
  milestone: MilestoneCode.optional().describe(
    "Obrigatório para milestone_acceptance: o marco cujo aceite é pedido. Só marco com GATE (gate_required); o marco sem GATE fecha quando é Entregue.",
  ),
  workstream_id: Uuid.optional().describe(
    "Obrigatório para client_visibility: a frente que passaria a aparecer ao cliente.",
  ),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Detalhes da proposta, no formato de cada tipo (conferido no pedido; fora dele, erro 400 com o formato certo). client_visibility: title_client e description_client. milestone_proposal: title (obrigatório), due_date (AAAA-MM-DD), acceptance_criteria (lista) e title_client, se o cliente for ver. replan: milestones [{ code, due_date }] e reason. scope_change: milestones [{ code, title?, acceptance_criteria? }]. external_message: body, o texto para o canal do cliente. Ao aprovar, o Hub aplica sozinho, em nome de quem aprovou: cria o marco (Planejado), muda as datas (o motivo vai para o histórico de datas), muda título e critérios (o que já estava feito continua feito) ou publica a mensagem.",
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
 * Campos do pedido que só o Hub preenche (a verificação, o texto do relatório e a reescrita
 * do RC-12); vindos de fora, são descartados. Sem isso, um pedido poderia trazer uma
 * "reescrita" que o Redator nunca fez, e o job dele pularia o pedido.
 */
const SERVER_PAYLOAD_KEYS = new Set([
  "checks",
  "report_body",
  "audience",
  "original_body",
  "original_title_client",
  "original_description_client",
  "rewritten_by",
  "rewrite_notes",
]);

/**
 * Abre um pedido de decisão humana. Agentes só pedem; quem decide é uma pessoa, pela
 * interface (PRD RF-26). Mesmo pedido pendente para o mesmo item vira conflito.
 */
export async function requestApproval(
  t: TxCtx,
  input: RequestApprovalInput,
): Promise<ApprovalDto> {
  if (input.type === "agent_key") return requestKeyRevocation(t, input);
  if (!input.project) {
    throw badRequest("Informe o project: o código do projeto, como HUB.");
  }
  const project = await resolveProject(t, input.project, "approval.request");
  assertNoSecrets({ title: input.title, summary: input.summary });
  // Campos que só o Hub preenche (verificação e texto do relatório) nunca vêm de fora.
  let payload: Record<string, unknown> = Object.fromEntries(
    Object.entries(input.payload ?? {}).filter(
      ([key]) => !SERVER_PAYLOAD_KEYS.has(key),
    ),
  );
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
    const m = await maybeOne<{
      id: string;
      status: string;
      gate_required: boolean;
    }>(
      t,
      `select id, status, gate_required from ${S}.milestones
        where project_id = $1 and code = $2 and archived_at is null`,
      [project.id, input.milestone],
    );
    if (!m)
      throw unprocessable(
        `O marco ${input.milestone} não existe no projeto ${project.code}.`,
      );
    if (m.status === "accepted")
      throw conflict(`O marco ${input.milestone} já foi aceito.`);
    // Marco sem GATE (RF-09) não tem aceite: fecha quando é Entregue.
    if (!m.gate_required)
      throw unprocessable(
        `O marco ${input.milestone} não tem GATE: ao terminar, basta marcar como Entregue.`,
      );
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
    // RC-12: os textos propostos para o cliente passam pela verificação.
    payload.checks = await checkProjectClientTexts(t, project.id, [
      titleClient,
      typeof payload.description_client === "string"
        ? payload.description_client
        : null,
    ]);
  } else if (isProposal(input.type)) {
    // RF-25: o formato de cada proposta é conferido já no pedido (marcos que existem e não
    // foram aceitos, datas válidas, texto para o cliente verificado pelo RC-12).
    try {
      payload = await prepareProposal(t, project, input.type, payload);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const where = err.issues
          .slice(0, 3)
          .map((i) => `${["payload", ...i.path].join(".")}: ${i.message}`)
          .join("; ");
        throw badRequest(
          `Pedido ${input.type} fora do formato (${where}). Envie ${PROPOSAL_HELP[input.type]}`,
        );
      }
      throw err;
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

  const dto = await insertApproval(t, project, {
    type: input.type,
    entity,
    title: input.title,
    summary: input.summary ?? null,
    payload,
    due_at: input.due_at ?? null,
  });
  // RC-12: o texto proposto para o cliente é reescrito no tom Harmony (job), se ligado.
  if (input.type === "client_visibility") await enqueueClientRewrite(t, dto.id);
  return dto;
}

const KeyRevocationPayload = z.object({
  key_id: Uuid,
  action: z.literal("revoke").optional(),
});

/**
 * Pedido de revogar a chave de um agente (agent_key, RF-25): quem audita o acesso (AC-14,
 * permissão de auditoria) pede; o dono decide e, ao aprovar, a chave é revogada na hora.
 * O pedido não é de um projeto. O Hub completa o prefixo da chave e o nome do agente.
 */
async function requestKeyRevocation(
  t: TxCtx,
  input: RequestApprovalInput,
): Promise<ApprovalDto> {
  authorize(t.actor, "approval.request");
  authorize(t.actor, "audit.read");
  if (input.project) {
    throw badRequest(
      "O pedido agent_key não é de um projeto: envie sem o project.",
    );
  }
  assertNoSecrets({ title: input.title, summary: input.summary });
  const parsed = KeyRevocationPayload.safeParse(input.payload ?? {});
  if (!parsed.success) {
    throw badRequest(
      "Envie em payload.key_id o id da chave a revogar (hub_get_access_audit traz o id de cada chave).",
    );
  }
  const key = await maybeOne<{
    key_prefix: string;
    revoked_at: Date | string | null;
    agent_name: string;
  }>(
    t,
    `select k.key_prefix, k.revoked_at, a.name as agent_name
       from ${S}.agent_api_keys k join ${S}.agents a on a.id = k.agent_id
      where k.id = $1`,
    [parsed.data.key_id],
  );
  if (!key) throw unprocessable("Chave não encontrada neste workspace.");
  if (key.revoked_at) throw conflict("Esta chave já foi revogada.");
  const pending = await maybeOne<{ id: string }>(
    t,
    `select id from ${S}.approvals
      where type = 'agent_key' and status = 'pending' and payload->>'key_id' = $1`,
    [parsed.data.key_id],
  );
  if (pending) {
    throw conflict("Já existe um pedido pendente para esta chave.", {
      approval_id: pending.id,
    });
  }
  return insertApproval(t, null, {
    type: "agent_key",
    entity: null,
    title: input.title,
    summary: input.summary ?? null,
    payload: {
      key_id: parsed.data.key_id,
      action: "revoke",
      key_prefix: key.key_prefix,
      agent_name: key.agent_name,
    },
    due_at: input.due_at ?? null,
  });
}

/**
 * Pedido de revisão da importação de um projeto (D10): aberto pelo próprio Hub no fim do
 * hub_import_plan, um só pendente por projeto. Aprovar tira o projeto de "Em revisão"
 * e o põe no status pedido (applyEffect); o Fábio decide no Hoje, um a um ou em lote.
 */
export async function requestImportReview(
  t: TxCtx,
  projectCode: string,
  input: {
    summary?: string;
    next_status: "discovery" | "active" | "paused";
    counts: {
      milestones: number;
      workstreams: number;
      tasks: number;
      completed: number;
      conflicts: number;
    };
  },
): Promise<{ id: string; created: boolean }> {
  const project = await resolveProject(t, projectCode, "project.import");
  const pending = await maybeOne<{ id: string }>(
    t,
    `select id from ${S}.approvals
      where type = 'import_review' and project_id = $1 and status = 'pending'`,
    [project.id],
  );
  if (pending) return { id: pending.id, created: false };
  const c = input.counts;
  const imported = `Importado do plan.md: ${c.milestones} marco(s), ${c.workstreams} frente(s) e ${c.tasks} tarefa(s), ${c.completed} já concluída(s)${c.conflicts ? `; ${c.conflicts} aviso(s) da importação` : ""}.`;
  const dto = await insertApproval(t, project, {
    type: "import_review",
    entity: { type: "project", id: project.id },
    title: `Revisar a importação de ${project.code} · ${project.name}`,
    // O resumo do pedido tem até 4000 caracteres: o do agente cede espaço à contagem.
    summary: [input.summary?.trim().slice(0, 3600), imported]
      .filter(Boolean)
      .join("\n\n"),
    payload: { next_status: input.next_status },
    due_at: null,
  });
  return { id: dto.id, created: true };
}

async function insertApproval(
  t: TxCtx,
  /** Sem projeto só o pedido de revogar chave (agent_key). */
  project: { id: string } | null,
  input: {
    type: z.infer<typeof ApprovalType>;
    entity: { type: string; id: string } | null;
    title: string;
    summary: string | null;
    payload: Record<string, unknown>;
    due_at: string | null;
  },
): Promise<ApprovalDto> {
  const inserted = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.approvals
       (workspace_id, project_id, type, entity_type, entity_id, title, summary, payload,
        requested_by_type, requested_by_id, acting_role, approver_profile_id, due_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
     returning id`,
    [
      t.actor.workspaceId,
      project?.id ?? null,
      input.type,
      input.entity?.type ?? null,
      input.entity?.id ?? null,
      input.title,
      input.summary,
      json(input.payload),
      t.actor.type,
      t.actor.id,
      t.actor.actingRole ?? null,
      await ownerProfileId(t),
      input.due_at,
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
    projectId: project?.id ?? null,
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
    effect,
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
      // RF-34: com a opção do projeto ligada, o relatório vai também por e-mail.
      const emailed = row.entity_id
        ? await enqueueReportEmail(t, row.entity_id)
        : false;
      return {
        applied: true,
        report_published: true,
        ...(emailed ? { report_email_queued: true } : {}),
      };
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
    case "agent_key": {
      // A chave pode ter sido revogada na Sala de Controle depois do pedido.
      const revoked = await maybeOne<{ id: string }>(
        t,
        `select id from ${S}.agent_api_keys where id = $1 and revoked_at is null`,
        [String(row.payload.key_id ?? "")],
      );
      if (!revoked) {
        return {
          applied: false,
          note: "A chave já estava revogada: nada mudou.",
        };
      }
      await revokeAgentKey(t, revoked.id);
      return { applied: true, key_revoked: row.payload.key_prefix ?? true };
    }
    default:
      // RF-25: marco novo, replanejamento, escopo e mensagem ao cliente.
      if (isProposal(row.type)) {
        return applyProposal(t, { ...row, type: row.type });
      }
      return {
        applied: false,
        note: "Sem efeito automático neste tipo: a decisão fica registrada para quem pediu.",
      };
  }
}

/**
 * Aprovação em lote das importações de projeto (D10), no Hoje: só pedidos import_review,
 * cada um num ponto de salvamento (o que falhar não desfaz os outros). Recusar ou pedir
 * ajuste continua sendo um a um, no cartão de cada pedido.
 */
export async function approveImportsInBatch(
  t: TxCtx,
  ids: string[],
): Promise<{
  approved: { id: string; project_code: string | null }[];
  failed: { id: string; message: string }[];
}> {
  authorize(t.actor, "approval.decide");
  const approved: { id: string; project_code: string | null }[] = [];
  const failed: { id: string; message: string }[] = [];
  for (const id of [...new Set(ids)].slice(0, 100)) {
    const row = await maybeOne<{ type: string }>(
      t,
      `select type::text as type from ${S}.approvals where id = $1`,
      [id],
    );
    if (!row || row.type !== "import_review") {
      failed.push({ id, message: "Não é um pedido de importação de projeto." });
      continue;
    }
    const outcome = await attempt(t, () =>
      decideApproval(t, id, {
        decision: "approved",
        note: "Aprovada em lote no Hoje.",
      }),
    );
    if (outcome.ok) {
      approved.push({ id, project_code: outcome.value.project_code });
    } else {
      failed.push({ id, message: outcome.error.detail });
    }
  }
  return { approved, failed };
}
