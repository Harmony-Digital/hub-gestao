import { z } from "zod";
import { audit, changedFields } from "@/lib/audit";
import { can } from "@/lib/authorize";
import { badRequest, forbidden, notFound, unprocessable } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import {
  authorizeProjectId,
  IsoDate,
  Line,
  resolveProject,
  Uuid,
  Visibility,
} from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";
import { emitEvent } from "@/modules/events";
import { requestApproval, type ApprovalDto } from "@/modules/approvals/service";
import type { MilestoneDto } from "@/modules/projects/schemas";
import { getMilestone } from "./service";

/**
 * Marcos pela interface (M3). Criar e editar é de pessoas com papel de administração
 * (milestone.write, D9). O aceite nunca acontece aqui: vira pedido de aprovação, que o
 * dono decide nas Aprovações, e o próprio banco recusa aceite que não seja de uma pessoa.
 */

/** Status que a tela escolhe; "Aceito" só pela aprovação. */
export const EditableMilestoneStatus = z.enum([
  "planned",
  "in_progress",
  "delivered",
]);

const Criterion = z.strictObject({ text: Line(300), done: z.boolean() });

const MilestoneFields = {
  title: Line(200),
  title_client: Line(200).nullable(),
  description_client: z.string().trim().max(2000).nullable(),
  due_date: IsoDate.nullable(),
  status: EditableMilestoneStatus,
  visibility: Visibility,
  acceptance_criteria: z.array(Criterion).max(30),
  /**
   * O marco fecha com o aceite do dono (GATE, o padrão) ou basta ser Entregue (RF-09).
   * Tirar o GATE é decisão do dono (D9); pôr de volta, de quem edita marcos.
   */
  gate_required: z.boolean().optional(),
};

export const CreateMilestoneInput = z.strictObject(MilestoneFields);
export type CreateMilestoneInput = z.infer<typeof CreateMilestoneInput>;

export const UpdateMilestoneInput = z.strictObject({
  ...MilestoneFields,
  /** Por que a data mudou (fica no histórico de datas do marco). */
  date_reason: z.string().trim().max(500).nullable().optional(),
});
export type UpdateMilestoneInput = z.infer<typeof UpdateMilestoneInput>;

const GATE_OWNER =
  "Tirar o GATE de um marco é decisão do dono: o aceite é dele (D9).";

/** Só quem aceita marcos (o dono) tira o GATE. */
function assertCanDropGate(t: TxCtx) {
  if (!can(t.actor, "milestone.accept")) throw forbidden(GATE_OWNER);
}

function guardText(input: CreateMilestoneInput) {
  // O portal mostra só o texto escrito para o cliente; nunca cai no título interno.
  if (input.visibility === "client" && !input.title_client) {
    throw badRequest(
      "Para o cliente ver o marco, escreva o título que ele vai ver.",
    );
  }
  assertNoSecrets({
    title: input.title,
    title_client: input.title_client,
    description_client: input.description_client,
    acceptance_criteria: input.acceptance_criteria
      .map((c) => c.text)
      .join("\n"),
  });
}

export async function createMilestone(
  t: TxCtx,
  projectCode: string,
  input: CreateMilestoneInput,
  /**
   * Importação do plan.md: o código do arquivo (se estiver livre) e a posição dele. O
   * agente importador (D10) cria marco só em projeto em revisão: `importer`.
   */
  extra: { code?: string; sortOrder?: number; importer?: boolean } = {},
): Promise<MilestoneDto> {
  const project = await resolveProject(
    t,
    projectCode,
    extra.importer ? "project.import" : "milestone.write",
  );
  if (extra.importer && project.status !== "in_review") {
    throw unprocessable(
      `O projeto ${project.code} não está em revisão: marco novo é decisão do Fábio (peça com hub_request_approval).`,
    );
  }
  guardText(input);
  if (input.gate_required === false) assertCanDropGate(t);
  // Próximo código (M1, M2…) e posição no fim da lista, com trava contra pedidos simultâneos.
  await t.tx.query(`select 1 from ${S}.projects where id = $1 for update`, [
    project.id,
  ]);
  const next = await maybeOne<{ n: number; sort: number }>(
    t,
    `select coalesce(max(substring(code from 2)::int), 0) + 1 as n,
            coalesce(max(sort_order), 0) + 1 as sort
       from ${S}.milestones where project_id = $1`,
    [project.id],
  );
  const wanted =
    extra.code && /^M[0-9]{1,3}$/.test(extra.code) ? extra.code : null;
  const taken = wanted
    ? await maybeOne(
        t,
        `select 1 from ${S}.milestones where project_id = $1 and code = $2`,
        [project.id, wanted],
      )
    : null;
  const code = wanted && !taken ? wanted : `M${next!.n}`;
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.milestones
       (workspace_id, project_id, code, title, title_client, description_client, due_date,
        sort_order, status, visibility, acceptance_criteria, delivered_at, gate_required)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::${S}.milestone_status, $10, $11::jsonb,
             case when $9::${S}.milestone_status = 'delivered' then now() end, $12)
     returning id`,
    [
      t.actor.workspaceId,
      project.id,
      code,
      input.title,
      input.title_client,
      input.description_client || null,
      input.due_date,
      extra.sortOrder ?? next!.sort,
      input.status,
      input.visibility,
      json(input.acceptance_criteria),
      input.gate_required ?? true,
    ],
  );
  const dto = await getMilestone(t, row!.id);
  await audit(t, {
    action: "milestone.created",
    entityType: "milestone",
    entityId: dto.id,
    projectId: project.id,
    after: {
      code: dto.code,
      title: dto.title,
      due_date: dto.due_date,
      status: dto.status,
      visibility: dto.visibility,
      gate_required: dto.gate_required,
    },
  });
  return dto;
}

const AUDIT_KEYS = [
  "title",
  "title_client",
  "description_client",
  "due_date",
  "status",
  "visibility",
  "acceptance_criteria",
  "gate_required",
] as const;

export async function updateMilestone(
  t: TxCtx,
  id: string,
  input: UpdateMilestoneInput,
): Promise<MilestoneDto> {
  if (!Uuid.safeParse(id).success) throw badRequest("Marco inválido.");
  const row = await maybeOne<{ project_id: string; status: string }>(
    t,
    `select project_id, status from ${S}.milestones where id = $1 and archived_at is null for update`,
    [id],
  );
  if (!row) throw notFound("Marco não encontrado neste workspace.");
  await authorizeProjectId(t, row.project_id, "milestone.write");
  if (row.status === "accepted") {
    throw unprocessable(
      "Marco aceito não muda mais. Se algo precisa ser refeito, crie um marco novo.",
    );
  }
  guardText(input);
  assertNoSecrets({ date_reason: input.date_reason });

  const before = await getMilestone(t, id);
  const next = {
    ...input,
    description_client: input.description_client || null,
    gate_required: input.gate_required ?? before.gate_required,
  };
  if (before.gate_required && !next.gate_required) {
    assertCanDropGate(t);
    const waiting = await maybeOne(
      t,
      `select 1 from ${S}.approvals
        where type = 'milestone_acceptance' and entity_id = $1 and status = 'pending'`,
      [id],
    );
    if (waiting) {
      throw unprocessable(
        `Há um pedido de aceite do ${before.code} esperando decisão. Decida o pedido antes de tirar o GATE.`,
      );
    }
  }
  const changes = changedFields(before, next, AUDIT_KEYS);
  if (Object.keys(changes.after).length === 0) return before;

  await t.tx.query(
    `update ${S}.milestones
        set title = $2, title_client = $3, description_client = $4, due_date = $5,
            status = $6::${S}.milestone_status, visibility = $7, acceptance_criteria = $8::jsonb,
            delivered_at = case
              when $6::${S}.milestone_status = 'delivered' then coalesce(delivered_at, now())
              else null end,
            gate_required = $9
      where id = $1`,
    [
      id,
      input.title,
      input.title_client,
      next.description_client,
      input.due_date,
      input.status,
      input.visibility,
      json(input.acceptance_criteria),
      next.gate_required,
    ],
  );
  if ("due_date" in changes.after) {
    await t.tx.query(
      `insert into ${S}.milestone_date_history
         (workspace_id, milestone_id, old_due, new_due, reason_internal, changed_by_type, changed_by_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        t.actor.workspaceId,
        id,
        before.due_date,
        input.due_date,
        input.date_reason || null,
        t.actor.type,
        t.actor.id,
      ],
    );
  }
  const after = await getMilestone(t, id);
  await audit(t, {
    action: "milestone.updated",
    entityType: "milestone",
    entityId: id,
    projectId: row.project_id,
    ...changes,
  });
  if (before.status !== after.status) {
    await emitEvent(t, "milestone.status_changed", {
      milestone: after.code,
      project_code: after.project_code,
      status: after.status,
    });
  }
  return after;
}

/**
 * Pede o aceite do marco: vira um pedido de aprovação para o dono decidir (D9). Pedido
 * igual já pendente vira conflito (o serviço de aprovações confere).
 */
export async function requestMilestoneAcceptance(
  t: TxCtx,
  id: string,
): Promise<ApprovalDto> {
  if (!Uuid.safeParse(id).success) throw badRequest("Marco inválido.");
  const milestone = await getMilestone(t, id);
  if (milestone.status === "accepted") {
    throw unprocessable(`O marco ${milestone.code} já foi aceito.`);
  }
  if (!milestone.gate_required) {
    throw unprocessable(
      `O marco ${milestone.code} não tem GATE: ao terminar, basta marcar como Entregue.`,
    );
  }
  const total = milestone.acceptance_criteria.length;
  const done = milestone.acceptance_criteria.filter((c) => c.done).length;
  return requestApproval(t, {
    type: "milestone_acceptance",
    project: milestone.project_code,
    milestone: milestone.code,
    title: `Aceite do ${milestone.code}: ${milestone.title}`.slice(0, 300),
    summary:
      total > 0
        ? `Critérios de aceite cumpridos: ${done} de ${total}. Progresso do marco: ${milestone.progress_pct}%.`
        : `Marco sem critérios de aceite cadastrados. Progresso: ${milestone.progress_pct}%.`,
  });
}

/** Marcos do projeto com pedido de aceite esperando decisão (para a tela mostrar). */
export async function pendingAcceptances(
  t: TxCtx,
  projectId: string,
): Promise<string[]> {
  const rows = await many<{ entity_id: string }>(
    t,
    `select entity_id from ${S}.approvals
      where type = 'milestone_acceptance' and status = 'pending' and project_id = $1`,
    [projectId],
  );
  return rows.map((r) => r.entity_id);
}

/**
 * Sobe ou desce o marco uma posição entre os marcos ativos do projeto (RF-09). A ordem é
 * a da Visão geral, do portal e do plan.md; o código (M1, M2…) não muda.
 */
export async function moveMilestone(
  t: TxCtx,
  id: string,
  direction: "up" | "down",
): Promise<void> {
  if (!Uuid.safeParse(id).success) throw badRequest("Marco inválido.");
  const row = await maybeOne<{ project_id: string; code: string }>(
    t,
    `select project_id, code from ${S}.milestones
      where id = $1 and archived_at is null`,
    [id],
  );
  if (!row) throw notFound("Marco não encontrado neste workspace.");
  await authorizeProjectId(t, row.project_id, "milestone.write");
  // Trava os marcos do projeto: dois movimentos ao mesmo tempo não se embaralham.
  const list = await many<{ id: string; sort_order: number }>(
    t,
    `select id, sort_order from ${S}.milestones
      where project_id = $1 and archived_at is null
      order by sort_order, code
      for update`,
    [row.project_id],
  );
  const from = list.findIndex((m) => m.id === id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= list.length) return;
  const order = list.map((m) => m.id);
  [order[from], order[to]] = [order[to], order[from]];
  for (const [index, milestoneId] of order.entries()) {
    const current = list.find((m) => m.id === milestoneId)!;
    if (current.sort_order !== index + 1) {
      await t.tx.query(
        `update ${S}.milestones set sort_order = $2 where id = $1`,
        [milestoneId, index + 1],
      );
    }
  }
  await audit(t, {
    action: "milestone.moved",
    entityType: "milestone",
    entityId: id,
    projectId: row.project_id,
    before: { position: from + 1 },
    after: { position: to + 1 },
  });
}
