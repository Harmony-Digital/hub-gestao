import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inTx } from "@/modules/context";
import { createCredential, revokeCredential } from "@/modules/llm/credentials";
import type { LlmProvider } from "@/modules/llm/providers";
import { count, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { costOf, generate, type ModelFactory } from "./index";

const S = "proj_hub_gestao";
// Chaves de mentira, só para o teste.
const KEYS: Record<LlmProvider, string> = {
  anthropic: "sk-ant-teste-fake-00000000000000000000000000",
  openai: "sk-openai-teste-fake-000000000000000000000000",
  xai: "xai-teste-fake-0000000000000000000000000000000",
};
let h: TestHub;
const credentials = {} as Record<LlmProvider, string>;

beforeAll(async () => {
  process.env.HUB_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  h = await openTestHub();
  for (const provider of ["anthropic", "openai", "xai"] as const) {
    credentials[provider] = (
      await inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
        createCredential(t, {
          provider,
          label: `Chave ${provider}`,
          key: KEYS[provider],
        }),
      )
    ).id;
  }
});
afterAll(async () => {
  await h.db.close();
});

const system = () => ctxFor(h, { ...h.owner_actor }, "system");

/** Configura o modelo do agente (a tela do modelo de IA vem no próximo passo). */
async function configure(
  provider: LlmProvider | null,
  extra: { budget?: number; priceIn?: number | null; priceOut?: number } = {},
) {
  const config: Record<string, number> = {};
  if (extra.priceIn !== null) config.llm_price_in = extra.priceIn ?? 3;
  config.llm_price_out = extra.priceOut ?? 15;
  await h.raw.query(
    `update ${S}.agents
        set llm_provider = $2::${S}.llm_provider, llm_model = $3, llm_credential_id = $4,
            budget_usd_month = $5, config = $6::jsonb, status = 'active'
      where id = $1`,
    [
      h.agents.kratos,
      provider,
      provider ? `modelo-${provider}` : null,
      provider ? credentials[provider] : null,
      extra.budget ?? 5,
      JSON.stringify(config),
    ],
  );
}

/** Modelo simulado: guarda a chamada e responde com texto e uso fixos. */
function mock(calls: { provider: string; key: string; model: string }[]) {
  const prompts: unknown[] = [];
  const factory: ModelFactory = (provider, key, model) => {
    calls.push({ provider, key, model });
    return new MockLanguageModelV4({
      doGenerate: async (options) => {
        prompts.push(options.prompt);
        return {
          content: [{ type: "text", text: `Olá do ${provider}` }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: {
              total: 1000,
              noCache: 1000,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 500, text: 500, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
  };
  return { factory, prompts };
}

const request = {
  agentId: "",
  purpose: "teste do adaptador",
  instructions: "Responda em PT-BR, numa frase.",
  prompt: "Diga olá.",
};

describe("adaptador de IA", () => {
  it("o mesmo agente responde com os três provedores, com a chave e o modelo de cada um", async () => {
    for (const provider of ["anthropic", "openai", "xai"] as const) {
      await configure(provider);
      const calls: { provider: string; key: string; model: string }[] = [];
      const { factory, prompts } = mock(calls);
      const result = await inTx(system(), (t) =>
        generate(
          t,
          { ...request, agentId: h.agents.kratos },
          { modelFor: factory },
        ),
      );
      expect(result).toEqual({
        ok: true,
        text: `Olá do ${provider}`,
        provider,
        model: `modelo-${provider}`,
        usage: { inputTokens: 1000, outputTokens: 500 },
        costUsd: costOf(
          { inputTokens: 1000, outputTokens: 500 },
          { in: 3, out: 15 },
        ),
      });
      expect(calls).toEqual([
        { provider, key: KEYS[provider], model: `modelo-${provider}` },
      ]);
      // Na Anthropic, as instruções vão com o cache de prompt.
      const first = (prompts[0] as { providerOptions?: unknown }[])[0];
      if (provider === "anthropic") {
        expect(first.providerOptions).toEqual({
          anthropic: { cacheControl: { type: "ephemeral" } },
        });
      } else {
        expect(first.providerOptions).toBeUndefined();
      }
    }
    // Cada chamada ficou registrada com o custo; o gasto do mês é a soma.
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.agent_runs where agent_id = $1 and source = 'llm' and error is null`,
        [h.agents.kratos],
      ),
    ).toBe(3);
    const spent = await h.raw.query<{ spent: string }>(
      `select spent_usd_month::text as spent from ${S}.agents where id = $1`,
      [h.agents.kratos],
    );
    expect(Number(spent.rows[0].spent)).toBeCloseTo(3 * 0.0105, 4);
  });

  it("falha fechada: sem modelo, sem orçamento, sem preço, sem saldo ou sem chave, não chama", async () => {
    const calls: { provider: string; key: string; model: string }[] = [];
    const { factory } = mock(calls);
    const run = (deps = {}) =>
      inTx(system(), (t) =>
        generate(
          t,
          { ...request, agentId: h.agents.kratos },
          { modelFor: factory, ...deps },
        ),
      );
    await configure(null);
    expect(await run()).toMatchObject({ ok: false, reason: "no_model" });
    await configure("openai", { budget: 0 });
    expect(await run()).toMatchObject({ ok: false, reason: "no_budget" });
    await configure("openai", { priceIn: null });
    expect(await run()).toMatchObject({ ok: false, reason: "no_price" });
    // O que já foi gasto no mês (teste anterior) mais a estimativa passa do orçamento.
    await configure("openai", { budget: 0.03 });
    expect(await run()).toMatchObject({ ok: false, reason: "budget_exceeded" });
    await configure("openai", { budget: 5 });
    expect(await run({ workspaceBudgetUsd: 0.01 })).toMatchObject({
      ok: false,
      reason: "workspace_budget_exceeded",
    });
    await h.raw.query(
      `update ${S}.agents set status = 'paused' where id = $1`,
      [h.agents.kratos],
    );
    expect(await run()).toMatchObject({ ok: false, reason: "agent_inactive" });
    await configure("xai");
    await inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
      revokeCredential(t, credentials.xai),
    );
    expect(await run()).toMatchObject({ ok: false, reason: "no_key" });
    expect(calls).toEqual([]);
  });

  it("erro do provedor volta como recusa, registrada, sem a mensagem do provedor", async () => {
    await configure("anthropic");
    const failing: ModelFactory = () =>
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw Object.assign(
            new Error(`invalid x-api-key ${KEYS.anthropic}`),
            { statusCode: 401 },
          );
        },
      });
    const result = await inTx(system(), (t) =>
      generate(
        t,
        { ...request, agentId: h.agents.kratos },
        { modelFor: failing },
      ),
    );
    expect(result).toEqual({
      ok: false,
      reason: "provider_error",
      detail: "O provedor recusou a chave (401/403): confira a chave de IA.",
    });
    const row = await h.raw.query<{ error: string }>(
      `select error from ${S}.agent_runs where agent_id = $1 and error is not null
        order by started_at desc limit 1`,
      [h.agents.kratos],
    );
    expect(row.rows[0].error).not.toContain(KEYS.anthropic);
  });
});
