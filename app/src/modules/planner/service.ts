import "server-only";
import { authorize } from "@/lib/authorize";
import { forbidden, unprocessable } from "@/lib/errors";
import { generateObject, type LlmDeps } from "@/lib/llm";
import { promptTag } from "@/modules/agents/prompts";
import { PLANNER_PROPOSE } from "@/modules/agents/prompts/planner";
import {
  inTx,
  many,
  maybeOne,
  S,
  type Ctx,
  type TxCtx,
} from "@/modules/context";
import { getProject } from "@/modules/projects/service";
import { PlanProposal } from "./proposal";
import {
  plannerMessage,
  renderPlan,
  type PlannerContext,
  type RenderedPlan,
} from "./render";

/**
 * PL-11 Planejador (AGENTES.md): do documento (PRD, brief, transcrição) para a proposta de
 * marcos, frentes e tarefas, escrita no formato do plan.md. Nada é criado aqui: a pessoa
 * revisa e edita o texto e importa pela tela Importar o plan.md, que mostra a prévia
 * antes de gravar (marco é decisão de pessoa: só o dono e a administração). Sem agente
 * com o papel PL-11 ou sem IA configurada, recusa com o motivo (falha fechada).
 */

export const PLANNER_ROLE = "PL-11";

export const NO_PLANNER =
  "O Planejador ainda não está ligado: na Sala de Controle, cadastre um agente com o papel PL-11 (Planejador) e escolha o modelo de IA dele.";

/** Tamanho máximo do documento (um PRD longo cabe; um livro, não). */
export const MAX_DOCUMENT = 60_000;
const MIN_DOCUMENT = 40;

export type PlannerResult =
  | ({ ok: true; costUsd: number } & RenderedPlan)
  | { ok: false; message: string };

/** O agente do Planejador: ativo e com o papel PL-11 (o interno primeiro). */
export async function plannerAgent(
  t: TxCtx,
): Promise<{ id: string; name: string; configured: boolean } | null> {
  return maybeOne<{ id: string; name: string; configured: boolean }>(
    t,
    `select id, name,
            (llm_provider is not null and llm_model is not null
              and llm_credential_id is not null and budget_usd_month > 0) as configured
       from ${S}.agents
      where workspace_id = $1 and status = 'active' and $2 = any(roles)
      order by (kind = 'internal') desc, created_at
      limit 1`,
    [t.actor.workspaceId, PLANNER_ROLE],
  );
}

export async function proposePlan(
  ctx: Ctx,
  input: { project: string; document: string },
  deps: LlmDeps = {},
): Promise<PlannerResult> {
  if (ctx.actor.type !== "user" || ctx.actor.scope !== "internal") {
    throw forbidden("O Planejador é só da equipe.");
  }
  const document = input.document.replace(/\r\n?/g, "\n").trim();
  if (document.length < MIN_DOCUMENT) {
    return {
      ok: false,
      message:
        "Cole o documento (PRD, brief ou transcrição), com pelo menos algumas frases.",
    };
  }
  if (document.length > MAX_DOCUMENT) {
    return {
      ok: false,
      message: `O documento passou de ${MAX_DOCUMENT.toLocaleString("pt-BR")} caracteres: deixe só o que for do escopo do projeto.`,
    };
  }
  const prepared = await inTx(ctx, async (t) => {
    // A proposta é para virar marcos: só quem cria marco (dono e administração) pede.
    authorize(t.actor, "milestone.write");
    const project = await getProject(t, input.project);
    if (project.status === "archived") {
      throw unprocessable("Projeto arquivado não recebe plano novo.");
    }
    const agent = await plannerAgent(t);
    if (!agent) return null;
    const context: PlannerContext = {
      today: (await maybeOne<{ today: string }>(
        t,
        "select current_date::text as today",
      ))!.today,
      project: {
        code: project.code,
        name: project.name,
        client: project.client.name,
        objective: project.objective_internal,
      },
      milestones: await many<{ code: string; title: string }>(
        t,
        `select code, title from ${S}.milestones
          where project_id = $1 and archived_at is null
          order by sort_order, code`,
        [project.id],
      ),
      departments: await many<{ slug: string; name: string }>(
        t,
        `select slug, name from ${S}.departments
          where workspace_id = $1 order by sort_order, name`,
        [t.actor.workspaceId],
      ),
    };
    return { agent, context };
  });
  if (!prepared) return { ok: false, message: NO_PLANNER };

  const answer = await generateObject(
    ctx,
    {
      agentId: prepared.agent.id,
      purpose: `Planejador · ${promptTag(PLANNER_PROPOSE)} · ${prepared.context.project.code}`,
      instructions: PLANNER_PROPOSE.instructions,
      prompt: plannerMessage(prepared.context, document),
      maxOutputTokens: 6000,
      schema: PlanProposal,
      schemaName: "proposta_de_plano",
      schemaDescription:
        "Marcos, frentes e tarefas do projeto, com critérios, prazos sugeridos e textos para o cliente.",
    },
    deps,
  );
  if (!answer.ok) return { ok: false, message: answer.detail };
  const plan = renderPlan(answer.object, prepared.context);
  if (plan.counts.milestones === 0) {
    return {
      ok: false,
      message:
        "O Planejador não achou marcos novos no documento. Confira se o documento descreve o escopo, ou se os marcos já existem no projeto.",
    };
  }
  return { ok: true, costUsd: answer.costUsd, ...plan };
}
