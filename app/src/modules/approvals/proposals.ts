import { z } from "zod";
import { unprocessable } from "@/lib/errors";
import { checkProjectClientTexts } from "@/modules/client-text/context";
import { postToClientChannel } from "@/modules/comments/client-channel";
import { IsoDate, Line, MilestoneCode } from "@/modules/common";
import { maybeOne, S, type TxCtx } from "@/modules/context";
import { createMilestone, updateMilestone } from "@/modules/milestones/admin";
import { getMilestone } from "@/modules/milestones/service";

/**
 * Pedidos com efeito automático ao aprovar (PRD RF-25): o agente propõe, o Fábio decide,
 * e o Hub aplica o que foi aprovado pelos mesmos casos de uso das telas, em nome de quem
 * decidiu. Cada tipo tem o formato dele, conferido já no pedido, para a decisão nunca
 * esbarrar em dado ruim:
 *
 * - `milestone_proposal`: marco novo (título, data, critérios e, se for aparecer ao
 *   cliente, o título para ele);
 * - `replan`: datas novas de marcos, com o motivo (vai para o histórico de datas);
 * - `scope_change`: título ou critérios de aceite de marcos;
 * - `external_message`: mensagem para o canal do cliente (o texto passa pela
 *   verificação do RC-12 e sai em nome de quem aprovou).
 */

export const PROPOSAL_TYPES = [
  "milestone_proposal",
  "replan",
  "scope_change",
  "external_message",
] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export function isProposal(type: string): type is ProposalType {
  return (PROPOSAL_TYPES as readonly string[]).includes(type);
}

const Criteria = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split("\n"))
      .map((c) => c.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean),
  )
  .pipe(z.array(Line(300)).max(30));

export const MilestoneProposalPayload = z.object({
  title: Line(200),
  due_date: IsoDate.nullish(),
  acceptance_criteria: Criteria.nullish(),
  title_client: Line(200).nullish(),
  description_client: z.string().trim().max(2000).nullish(),
});

export const ReplanPayload = z.object({
  milestones: z
    .array(z.object({ code: MilestoneCode, due_date: IsoDate }))
    .min(1)
    .max(20),
  reason: z.string().trim().max(500).nullish(),
});

export const ScopeChangePayload = z.object({
  milestones: z
    .array(
      z
        .object({
          code: MilestoneCode,
          title: Line(200).nullish(),
          acceptance_criteria: Criteria.nullish(),
        })
        .refine((m) => m.title || m.acceptance_criteria, {
          message: "Diga o que muda no marco: title ou acceptance_criteria.",
        }),
    )
    .min(1)
    .max(20),
});

export const ExternalMessagePayload = z.object({
  body: z.string().trim().min(1).max(4000),
});

const PAYLOAD_SCHEMA: Record<ProposalType, z.ZodType> = {
  milestone_proposal: MilestoneProposalPayload,
  replan: ReplanPayload,
  scope_change: ScopeChangePayload,
  external_message: ExternalMessagePayload,
};

/** Para o pedido sem formato certo: o que o agente precisa mandar, em uma frase. */
export const PROPOSAL_HELP: Record<ProposalType, string> = {
  milestone_proposal:
    "payload.title (obrigatório), due_date (AAAA-MM-DD), acceptance_criteria (lista) e, para o cliente ver, title_client.",
  replan:
    'payload.milestones: [{ code: "M2", due_date: "AAAA-MM-DD" }] e payload.reason (o motivo, que fica no histórico de datas).',
  scope_change:
    'payload.milestones: [{ code: "M2", title?, acceptance_criteria? }], com pelo menos uma mudança por marco.',
  external_message:
    "payload.body: o texto para o canal do cliente (até 4000 caracteres), escrito para o cliente.",
};

type MilestoneRef = { id: string; code: string; status: string };

async function milestonesOf(
  t: TxCtx,
  projectId: string,
  codes: string[],
): Promise<Map<string, MilestoneRef>> {
  const unique = [...new Set(codes)];
  if (unique.length !== codes.length) {
    throw unprocessable("O mesmo marco aparece duas vezes no pedido.");
  }
  const found = new Map<string, MilestoneRef>();
  for (const code of unique) {
    const row = await maybeOne<MilestoneRef>(
      t,
      `select id, code, status::text as status from ${S}.milestones
        where project_id = $1 and code = $2 and archived_at is null`,
      [projectId, code],
    );
    if (!row) throw unprocessable(`O marco ${code} não existe neste projeto.`);
    if (row.status === "accepted") {
      throw unprocessable(
        `O marco ${code} já foi aceito e não muda mais: proponha um marco novo.`,
      );
    }
    found.set(code, row);
  }
  return found;
}

/**
 * Confere o pedido e devolve o payload no formato que a decisão usa (campos conhecidos,
 * já limpos, mais a verificação do texto para o cliente quando houver).
 */
export async function prepareProposal(
  t: TxCtx,
  project: { id: string; status: string },
  type: ProposalType,
  raw: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (type) {
    case "milestone_proposal": {
      const p = MilestoneProposalPayload.parse(raw);
      const out: Record<string, unknown> = {
        title: p.title,
        due_date: p.due_date ?? null,
        acceptance_criteria: p.acceptance_criteria ?? [],
        title_client: p.title_client ?? null,
        description_client: p.description_client || null,
      };
      if (p.title_client || p.description_client) {
        out.checks = await checkProjectClientTexts(t, project.id, [
          p.title_client ?? null,
          p.description_client ?? null,
        ]);
      }
      return out;
    }
    case "replan": {
      const p = ReplanPayload.parse(raw);
      await milestonesOf(
        t,
        project.id,
        p.milestones.map((m) => m.code),
      );
      return { milestones: p.milestones, reason: p.reason || null };
    }
    case "scope_change": {
      const p = ScopeChangePayload.parse(raw);
      await milestonesOf(
        t,
        project.id,
        p.milestones.map((m) => m.code),
      );
      return {
        milestones: p.milestones.map((m) => ({
          code: m.code,
          ...(m.title ? { title: m.title } : {}),
          ...(m.acceptance_criteria
            ? { acceptance_criteria: m.acceptance_criteria }
            : {}),
        })),
      };
    }
    case "external_message": {
      if (project.status === "in_review") {
        throw unprocessable(
          "Projeto em revisão ainda não tem conversa com o cliente.",
        );
      }
      const p = ExternalMessagePayload.parse(raw);
      return {
        body: p.body,
        checks: await checkProjectClientTexts(t, project.id, [p.body]),
      };
    }
  }
}

async function projectCode(t: TxCtx, projectId: string): Promise<string> {
  const row = await maybeOne<{ code: string }>(
    t,
    `select code from ${S}.projects where id = $1`,
    [projectId],
  );
  if (!row) throw unprocessable("O projeto do pedido não existe mais.");
  return row.code;
}

/**
 * Aplica o que foi aprovado, em nome de quem decidiu. Se algo mudou desde o pedido (marco
 * aceito, apagado ou projeto arquivado), a decisão para com a explicação: dá para pedir
 * ajuste ou recusar.
 */
export async function applyProposal(
  t: TxCtx,
  row: {
    type: ProposalType;
    project_id: string | null;
    payload: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  if (!row.project_id) throw unprocessable("Pedido sem projeto.");
  // Pedido de antes do formato de cada tipo: nada muda sozinho, como o cartão dele diz.
  if (!PAYLOAD_SCHEMA[row.type].safeParse(row.payload).success) {
    return { applied: false };
  }
  const code = await projectCode(t, row.project_id);
  switch (row.type) {
    case "milestone_proposal": {
      const p = MilestoneProposalPayload.parse(row.payload);
      const created = await createMilestone(t, code, {
        title: p.title,
        title_client: p.title_client ?? null,
        description_client: p.description_client || null,
        due_date: p.due_date ?? null,
        status: "planned",
        visibility: p.title_client ? "client" : "internal",
        acceptance_criteria: (p.acceptance_criteria ?? []).map((text) => ({
          text,
          done: false,
        })),
      });
      return { applied: true, milestone: created.code };
    }
    case "replan": {
      const p = ReplanPayload.parse(row.payload);
      const refs = await milestonesOf(
        t,
        row.project_id,
        p.milestones.map((m) => m.code),
      );
      const changed: { code: string; from: string | null; to: string }[] = [];
      for (const m of p.milestones) {
        const current = await getMilestone(t, refs.get(m.code)!.id);
        await updateMilestone(t, current.id, {
          ...editable(current),
          due_date: m.due_date,
          date_reason: p.reason || "Replanejamento aprovado.",
        });
        changed.push({ code: m.code, from: current.due_date, to: m.due_date });
      }
      return { applied: true, replanned: changed };
    }
    case "scope_change": {
      const p = ScopeChangePayload.parse(row.payload);
      const refs = await milestonesOf(
        t,
        row.project_id,
        p.milestones.map((m) => m.code),
      );
      for (const m of p.milestones) {
        const current = await getMilestone(t, refs.get(m.code)!.id);
        const done = new Set(
          current.acceptance_criteria.filter((c) => c.done).map((c) => c.text),
        );
        await updateMilestone(t, current.id, {
          ...editable(current),
          title: m.title ?? current.title,
          acceptance_criteria: m.acceptance_criteria
            ? m.acceptance_criteria.map((text) => ({
                text,
                done: done.has(text),
              }))
            : current.acceptance_criteria,
        });
      }
      return {
        applied: true,
        scope_changed: p.milestones.map((m) => m.code),
      };
    }
    case "external_message": {
      const p = ExternalMessagePayload.parse(row.payload);
      const posted = await postToClientChannel(t, code, p.body);
      return { applied: true, client_message: posted.id };
    }
  }
}

/** Os campos editáveis do marco como estão (a decisão muda só o que foi aprovado). */
function editable(m: Awaited<ReturnType<typeof getMilestone>>) {
  if (m.status === "accepted") {
    throw unprocessable(
      `O marco ${m.code} foi aceito depois do pedido e não muda mais. Recuse ou peça ajuste.`,
    );
  }
  return {
    title: m.title,
    title_client: m.title_client,
    description_client: m.description_client,
    due_date: m.due_date,
    status: m.status,
    visibility: m.visibility,
    acceptance_criteria: m.acceptance_criteria,
  };
}
