import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import { generateText, type LanguageModel } from "ai";
import { log } from "@/lib/log";
import { maybeOne, S, type TxCtx } from "@/modules/context";
import { credentialSecret } from "@/modules/llm/credentials";
import type { LlmProvider } from "@/modules/llm/providers";

/**
 * Adaptador de IA do Hub (decisão D5): cada chamada lê do agente o provedor, o modelo, a
 * chave e o orçamento, então trocar o modelo na tela vale já na chamada seguinte, sem
 * publicar nada. Falha fechada: sem modelo, sem chave, sem orçamento ou sem preço, o
 * agente não usa IA e o Hub segue funcionando sem as funções de redação. Nunca lança
 * erro do provedor para quem chamou: devolve `ok: false` com o motivo.
 *
 * O custo vem do preço por milhão de tokens configurado no agente (pelo Fábio, na tela),
 * nunca de uma tabela inventada. Antes da chamada, o custo máximo estimado precisa caber
 * no orçamento do mês do agente e no teto do workspace (LLM_MONTHLY_BUDGET_USD); depois,
 * o custo real fica em `agent_runs` e no gasto do mês. Prompt e chave nunca vão para o
 * log nem para o histórico.
 */

export type LlmRequest = {
  agentId: string;
  /** Para que é a chamada (ex.: "CO-10 interpretação"): vai para o registro. */
  purpose: string;
  instructions: string;
  prompt: string;
  maxOutputTokens?: number;
};

export type LlmRefusal =
  | "agent_inactive"
  | "no_model"
  | "no_key"
  | "no_budget"
  | "no_price"
  | "budget_exceeded"
  | "workspace_budget_exceeded"
  | "provider_error";

export type LlmResult =
  | {
      ok: true;
      text: string;
      provider: LlmProvider;
      model: string;
      usage: { inputTokens: number; outputTokens: number };
      costUsd: number;
    }
  | { ok: false; reason: LlmRefusal; detail: string };

export type ModelFactory = (
  provider: LlmProvider,
  apiKey: string,
  model: string,
) => LanguageModel;

/** Modelo do provedor com a chave do agente (uma instância por chamada). */
export const providerModel: ModelFactory = (provider, apiKey, model) => {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    case "openai":
      return createOpenAI({ apiKey })(model);
    case "xai":
      return createXai({ apiKey })(model);
  }
};

export type LlmDeps = {
  modelFor?: ModelFactory;
  /** Teto do workspace no mês, em dólares (padrão: LLM_MONTHLY_BUDGET_USD). */
  workspaceBudgetUsd?: number | null;
  timeoutMs?: number;
};

type AgentRow = {
  id: string;
  name: string;
  status: string;
  llm_provider: LlmProvider | null;
  llm_model: string | null;
  llm_credential_id: string | null;
  budget: number;
  price_in: number | null;
  price_out: number | null;
};

const DEFAULT_MAX_OUTPUT = 1024;

/** Mês corrente no fuso da Harmony (o orçamento é mensal). */
const MONTH_START = `date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`;

function workspaceBudget(deps: LlmDeps): number | null {
  if (deps.workspaceBudgetUsd !== undefined) return deps.workspaceBudgetUsd;
  const value = Number(process.env.LLM_MONTHLY_BUDGET_USD);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const refuse = (reason: LlmRefusal, detail: string): LlmResult => ({
  ok: false,
  reason,
  detail,
});

/** Custo pelo preço por milhão de tokens (entrada e saída). */
export function costOf(
  usage: { inputTokens: number; outputTokens: number },
  price: { in: number; out: number },
): number {
  return (usage.inputTokens * price.in + usage.outputTokens * price.out) / 1e6;
}

/**
 * Recalcula o gasto do mês a partir das execuções: de um agente, depois de cada chamada,
 * ou de todos (job agent-spend, a cada hora, que acerta a virada do mês).
 */
export async function refreshAgentSpend(
  t: TxCtx,
  agentId: string | null = null,
): Promise<number> {
  const rows = await t.tx.query(
    `update ${S}.agents a
        set spent_usd_month = coalesce((
          select sum(r.cost_usd) from ${S}.agent_runs r
           where r.agent_id = a.id and r.started_at >= ${MONTH_START}), 0)
      where ($1::uuid is null or a.id = $1)
        and a.workspace_id = $2
      returning a.id`,
    [agentId, t.actor.workspaceId],
  );
  return rows.rows.length;
}

export async function generate(
  t: TxCtx,
  request: LlmRequest,
  deps: LlmDeps = {},
): Promise<LlmResult> {
  const agent = await maybeOne<AgentRow>(
    t,
    `select a.id, a.name, a.status::text as status, a.llm_provider::text as llm_provider,
            a.llm_model, a.llm_credential_id, a.budget_usd_month::float8 as budget,
            nullif(a.config ->> 'llm_price_in', '')::float8 as price_in,
            nullif(a.config ->> 'llm_price_out', '')::float8 as price_out
       from ${S}.agents a where a.id = $1`,
    [request.agentId],
  );
  if (!agent || agent.status !== "active") {
    return refuse("agent_inactive", "O agente não está ativo.");
  }
  if (!agent.llm_provider || !agent.llm_model || !agent.llm_credential_id) {
    return refuse(
      "no_model",
      `${agent.name} ainda não tem modelo de IA (provedor, modelo e chave), na Sala de Controle.`,
    );
  }
  if (!(agent.budget > 0)) {
    return refuse(
      "no_budget",
      `${agent.name} não tem orçamento de IA no mês: sem orçamento, o agente não usa IA.`,
    );
  }
  if (
    agent.price_in === null ||
    agent.price_out === null ||
    agent.price_in < 0 ||
    agent.price_out < 0
  ) {
    return refuse(
      "no_price",
      `Falta o preço por milhão de tokens do modelo de ${agent.name}: sem ele, o Hub não controla o orçamento.`,
    );
  }
  const price = { in: agent.price_in, out: agent.price_out };
  const maxOutputTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT;
  // Estimativa conservadora: ~4 caracteres por token na entrada e a saída máxima.
  const estimate = costOf(
    {
      inputTokens: Math.ceil(
        (request.instructions.length + request.prompt.length) / 4,
      ),
      outputTokens: maxOutputTokens,
    },
    price,
  );
  const spent = await maybeOne<{ agent: number; workspace: number }>(
    t,
    `select
       coalesce((select sum(cost_usd) from ${S}.agent_runs
                  where agent_id = $1 and started_at >= ${MONTH_START}), 0)::float8 as agent,
       coalesce((select sum(cost_usd) from ${S}.agent_runs
                  where workspace_id = $2 and started_at >= ${MONTH_START}), 0)::float8 as workspace`,
    [agent.id, t.actor.workspaceId],
  );
  if ((spent?.agent ?? 0) + estimate > agent.budget) {
    return refuse(
      "budget_exceeded",
      `O orçamento de IA de ${agent.name} no mês não comporta esta chamada.`,
    );
  }
  const ceiling = workspaceBudget(deps);
  if (ceiling !== null && (spent?.workspace ?? 0) + estimate > ceiling) {
    return refuse(
      "workspace_budget_exceeded",
      "O teto de IA do workspace no mês não comporta esta chamada.",
    );
  }
  const secret = await credentialSecret(t, agent.llm_credential_id);
  if (!secret || secret.provider !== agent.llm_provider) {
    return refuse(
      "no_key",
      `A chave de IA de ${agent.name} foi revogada ou não é do provedor escolhido.`,
    );
  }

  const provider = agent.llm_provider;
  const model = agent.llm_model;
  const startedAt = new Date();
  try {
    const result = await generateText({
      model: (deps.modelFor ?? providerModel)(provider, secret.key, model),
      // Na Anthropic, as instruções (que se repetem) ficam em cache.
      instructions:
        provider === "anthropic"
          ? {
              role: "system",
              content: request.instructions,
              providerOptions: {
                anthropic: { cacheControl: { type: "ephemeral" } },
              },
            }
          : request.instructions,
      prompt: request.prompt,
      maxOutputTokens,
      abortSignal: AbortSignal.timeout(deps.timeoutMs ?? 60_000),
    });
    const usage = {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    };
    const costUsd = costOf(usage, price);
    await recordRun(t, agent.id, request.purpose, startedAt, costUsd, null);
    log.info(
      {
        agent_id: agent.id,
        provider,
        model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cost_usd: costUsd,
      },
      "chamada de IA",
    );
    return { ok: true, text: result.text, provider, model, usage, costUsd };
  } catch (err) {
    // A mensagem do provedor pode citar a chave; para o registro, só o tipo do erro.
    const detail = providerErrorDetail(err);
    await recordRun(t, agent.id, request.purpose, startedAt, 0, detail);
    log.warn(
      { agent_id: agent.id, provider, model, error: detail },
      "IA falhou",
    );
    return refuse("provider_error", detail);
  }
}

function providerErrorDetail(err: unknown): string {
  const status =
    typeof err === "object" && err && "statusCode" in err
      ? Number((err as { statusCode?: number }).statusCode)
      : NaN;
  if (status === 401 || status === 403) {
    return "O provedor recusou a chave (401/403): confira a chave de IA.";
  }
  if (status === 429)
    return "O provedor limitou os pedidos (429): tente mais tarde.";
  if (status === 404)
    return "O provedor não achou o modelo (404): confira o nome do modelo.";
  if (err instanceof Error && err.name === "TimeoutError") {
    return "O provedor demorou demais para responder.";
  }
  return Number.isFinite(status)
    ? `O provedor respondeu com erro (${status}).`
    : "Não foi possível falar com o provedor de IA.";
}

async function recordRun(
  t: TxCtx,
  agentId: string,
  purpose: string,
  startedAt: Date,
  costUsd: number,
  error: string | null,
) {
  await t.tx.query(
    `insert into ${S}.agent_runs (workspace_id, agent_id, started_at, finished_at, source, summary, cost_usd, error)
     values ($1, $2, $3, now(), 'llm', $4, $5, $6)`,
    [
      t.actor.workspaceId,
      agentId,
      startedAt,
      purpose.slice(0, 200),
      costUsd,
      error,
    ],
  );
  await refreshAgentSpend(t, agentId);
}
