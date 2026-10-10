import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { notFound, unprocessable } from "@/lib/errors";
import { Uuid } from "@/modules/common";
import { maybeOne, S, type TxCtx } from "@/modules/context";
import { credentialSecret } from "./credentials";
import { LLM_PROVIDERS, type LlmProvider } from "./providers";

/**
 * Modelo de IA de cada agente (decisão D5): provedor, modelo, chave, preço por milhão de
 * tokens e teto do mês. Só o dono troca (escolher a chave é dar acesso a ela). A troca
 * fica no histórico (sem a chave) e vale na chamada seguinte do adaptador, sem publicar.
 */

const Price = z.number().min(0).max(1000);

export const AgentModelInput = z.union([
  z.strictObject({ off: z.literal(true) }),
  z.strictObject({
    provider: z.enum(LLM_PROVIDERS),
    model: z
      .string()
      .trim()
      .min(1, "Informe o modelo.")
      .max(120, "O nome do modelo passou de 120 caracteres.")
      .regex(/^[A-Za-z0-9._:/-]+$/, "O nome do modelo não tem espaços."),
    credential_id: Uuid,
    price_in: Price,
    price_out: Price,
    budget_usd_month: z.number().min(0).max(100000),
  }),
]);
export type AgentModelInput = z.infer<typeof AgentModelInput>;

export type AgentModel = {
  provider: LlmProvider | null;
  model: string | null;
  credentialId: string | null;
  credentialLabel: string | null;
  credentialLast4: string | null;
  priceIn: number | null;
  priceOut: number | null;
};

type Row = {
  id: string;
  name: string;
  llm_provider: LlmProvider | null;
  llm_model: string | null;
  llm_credential_id: string | null;
  budget: number;
  price_in: number | null;
  price_out: number | null;
  label: string | null;
};

async function agentRow(t: TxCtx, agentId: string): Promise<Row> {
  if (!Uuid.safeParse(agentId).success)
    throw notFound("Agente não encontrado.");
  const row = await maybeOne<Row>(
    t,
    `select a.id, a.name, a.llm_provider::text as llm_provider, a.llm_model,
            a.llm_credential_id, a.budget_usd_month::float8 as budget,
            nullif(a.config ->> 'llm_price_in', '')::float8 as price_in,
            nullif(a.config ->> 'llm_price_out', '')::float8 as price_out,
            c.label
       from ${S}.agents a
       left join ${S}.llm_credentials c on c.id = a.llm_credential_id
      where a.id = $1 for update of a`,
    [agentId],
  );
  if (!row) throw notFound("Agente não encontrado.");
  return row;
}

/** Troca (ou desliga) o modelo de IA do agente. Devolve os campos que mudaram. */
export async function setAgentModel(
  t: TxCtx,
  agentId: string,
  raw: z.input<typeof AgentModelInput>,
): Promise<string[]> {
  authorize(t.actor, "agent.keys");
  const input = AgentModelInput.parse(raw);
  const row = await agentRow(t, agentId);
  const before = {
    provider: row.llm_provider,
    model: row.llm_model,
    credential: row.label,
    price_in: row.price_in,
    price_out: row.price_out,
    budget_usd_month: row.budget,
  };

  if ("off" in input) {
    if (!row.llm_provider && !row.llm_model && !row.llm_credential_id)
      return [];
    await t.tx.query(
      `update ${S}.agents
          set llm_provider = null, llm_model = null, llm_credential_id = null,
              updated_at = now()
        where id = $1`,
      [agentId],
    );
    await audit(t, {
      action: "agent.model_changed",
      entityType: "agent",
      entityId: agentId,
      before,
      after: { provider: null, model: null, credential: null },
    });
    return ["off"];
  }

  const credential = await maybeOne<{ provider: LlmProvider; label: string }>(
    t,
    `select provider::text as provider, label from ${S}.llm_credentials
      where id = $1 and revoked_at is null`,
    [input.credential_id],
  );
  if (!credential) {
    throw unprocessable("A chave escolhida não existe ou foi revogada.");
  }
  if (credential.provider !== input.provider) {
    throw unprocessable("A chave escolhida é de outro provedor.");
  }
  const after = {
    provider: input.provider,
    model: input.model,
    credential: credential.label,
    price_in: input.price_in,
    price_out: input.price_out,
    budget_usd_month: input.budget_usd_month,
  };
  const changed = (Object.keys(after) as (keyof typeof after)[]).filter(
    (k) => before[k] !== after[k],
  );
  if (changed.length === 0 && row.llm_credential_id === input.credential_id) {
    return [];
  }
  await t.tx.query(
    `update ${S}.agents
        set llm_provider = $2::${S}.llm_provider, llm_model = $3, llm_credential_id = $4,
            budget_usd_month = $5,
            config = config || jsonb_build_object('llm_price_in', $6::numeric, 'llm_price_out', $7::numeric),
            updated_at = now()
      where id = $1`,
    [
      agentId,
      input.provider,
      input.model,
      input.credential_id,
      input.budget_usd_month,
      input.price_in,
      input.price_out,
    ],
  );
  await audit(t, {
    action: "agent.model_changed",
    entityType: "agent",
    entityId: agentId,
    before,
    after,
  });
  return changed.length ? changed : ["credential"];
}

export type ModelList =
  { ok: true; models: string[] } | { ok: false; message: string };

const MODELS_URL: Record<LlmProvider, string> = {
  anthropic: "https://api.anthropic.com/v1/models?limit=100",
  openai: "https://api.openai.com/v1/models",
  xai: "https://api.x.ai/v1/models",
};

/**
 * Lista de modelos do provedor, buscada no servidor com a chave guardada (só o dono pede).
 * A chave não sai do servidor; erro do provedor volta com texto próprio.
 */
export async function providerModels(
  t: TxCtx,
  credentialId: string,
  doFetch: typeof fetch = fetch,
): Promise<ModelList> {
  authorize(t.actor, "agent.keys");
  if (!Uuid.safeParse(credentialId).success) {
    return { ok: false, message: "Escolha a chave." };
  }
  const secret = await credentialSecret(t, credentialId);
  if (!secret) return { ok: false, message: "A chave foi revogada." };
  const headers: Record<string, string> =
    secret.provider === "anthropic"
      ? { "x-api-key": secret.key, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${secret.key}` };
  let res: Response;
  try {
    res = await doFetch(MODELS_URL[secret.provider], {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, message: "Não foi possível falar com o provedor." };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: "O provedor recusou a chave." };
  }
  if (!res.ok) {
    return {
      ok: false,
      message: `O provedor respondeu com erro (${res.status}).`,
    };
  }
  const body = (await res.json().catch(() => null)) as {
    data?: { id?: unknown }[];
  } | null;
  const models = (body?.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length <= 120)
    .sort((a, b) => a.localeCompare(b));
  return { ok: true, models };
}
