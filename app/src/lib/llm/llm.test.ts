import { generateText, Output } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { inTx } from "@/modules/context";
import { systemActor } from "@/modules/jobs/service";
import { createCredential, revokeCredential } from "@/modules/llm/credentials";
import type { LlmProvider } from "@/modules/llm/providers";
import { count, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { fakeModel } from "./dev-fake";
import { costOf, generate, generateObject, type ModelFactory } from "./index";

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
      const result = await generate(
        system(),
        { ...request, agentId: h.agents.kratos },
        { modelFor: factory },
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
      generate(
        system(),
        { ...request, agentId: h.agents.kratos },
        { modelFor: factory, ...deps },
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
    const result = await generate(
      system(),
      { ...request, agentId: h.agents.kratos },
      { modelFor: failing },
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
  it("resposta estruturada: o objeto vem conferido pelo esquema; fora do formato vira recusa registrada", async () => {
    await configure("openai");
    const Intent = z.object({
      kind: z.enum(["create_task", "unknown"]),
      title: z.string().nullable(),
    });
    const formats: unknown[] = [];
    const answering =
      (text: string): ModelFactory =>
      () =>
        new MockLanguageModelV4({
          doGenerate: async (options) => {
            formats.push(options.responseFormat);
            return {
              content: [{ type: "text", text }],
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
    const ask = (text: string) =>
      generateObject(
        system(),
        {
          ...request,
          agentId: h.agents.kratos,
          schema: Intent,
          schemaName: "acao",
        },
        { modelFor: answering(text) },
      );

    expect(await ask('{"kind":"create_task","title":"Revisar"}')).toEqual({
      ok: true,
      object: { kind: "create_task", title: "Revisar" },
      provider: "openai",
      model: "modelo-openai",
      usage: { inputTokens: 1000, outputTokens: 500 },
      costUsd: costOf(
        { inputTokens: 1000, outputTokens: 500 },
        { in: 3, out: 15 },
      ),
    });
    // O provedor recebe o pedido de JSON com o esquema e o nome.
    expect(formats[0]).toMatchObject({ type: "json", name: "acao" });

    expect(await ask('{"kind":"outra coisa"}')).toEqual({
      ok: false,
      reason: "invalid_output",
      detail: expect.stringContaining("fora do formato"),
    });
    // Fora do formato também gastou: a execução fica registrada com o custo.
    const row = await h.raw.query<{ cost: string; error: string }>(
      `select cost_usd::text as cost, error from ${S}.agent_runs
        where agent_id = $1 order by started_at desc limit 1`,
      [h.agents.kratos],
    );
    expect(row.rows[0].error).toContain("fora do formato");
    expect(Number(row.rows[0].cost)).toBeCloseTo(0.0105, 6);
  });

  it("modelo simulado (só no computador): texto responde ok; objeto devolve o JSON do fim do pedido", async () => {
    const model = fakeModel("openai", "sem-chave", "modelo-simulado");
    expect((await generateText({ model, prompt: "Teste." })).text).toBe("ok");
    const Intent = z.object({
      kind: z.enum(["create_task", "unknown"]),
      title: z.string().nullable(),
    });
    const answer = await generateText({
      model,
      prompt: 'Contexto do pedido.\nPEDIDO:\n{"kind":"create_task"}',
      output: Output.object({ schema: Intent }),
    });
    // O campo que faltou no JSON vem como null.
    expect(answer.output).toEqual({ kind: "create_task", title: null });
    // JSON com objetos dentro (a proposta do Planejador), depois de um texto com chaves.
    const Tree = z.object({
      items: z.array(z.object({ name: z.string() })),
      note: z.string().nullable(),
    });
    const tree = await generateText({
      model,
      prompt:
        'Documento com {chaves} soltas.\n{"items":[{"name":"a"},{"name":"b"}]}',
      output: Output.object({ schema: Tree }),
    });
    expect(tree.output).toEqual({
      items: [{ name: "a" }, { name: "b" }],
      note: null,
    });
    await expect(
      generateText({
        model,
        prompt: "PEDIDO: sem JSON",
        output: Output.object({ schema: Intent }),
      }),
    ).rejects.toThrow();
  });
  it("orçamento estourado avisa o dono e os webhooks, uma vez por dia por agente", async () => {
    await h.raw.query(
      `insert into ${S}.webhooks (workspace_id, url, events, secret_ciphertext)
       values ($1, 'https://hermes.exemplo.com.br/hub', array['agent.budget_exceeded'], 'cifrado')`,
      [h.ws],
    );
    // O Executor, com um teto que não comporta nem uma chamada.
    await h.raw.query(
      `update ${S}.agents
          set llm_provider = 'openai', llm_model = 'modelo-openai', llm_credential_id = $2,
              budget_usd_month = 0.01, status = 'active',
              config = '{"llm_price_in": 3, "llm_price_out": 15}'::jsonb
        where id = $1`,
      [h.agents.executor, credentials.openai],
    );
    const calls: { provider: string; key: string; model: string }[] = [];
    const { factory } = mock(calls);
    // Como rotina do sistema: quem dispara a ação não recebe o aviso dela.
    const routine = {
      db: h.db,
      actor: systemActor(h.ws),
      source: "cron" as const,
      requestId: "teste-orcamento",
    };
    for (let i = 0; i < 2; i++) {
      expect(
        await generate(
          routine,
          { ...request, agentId: h.agents.executor },
          { modelFor: factory },
        ),
      ).toMatchObject({ ok: false, reason: "budget_exceeded" });
    }
    expect(calls).toEqual([]);
    const counted = async (sql: string) => count(h, sql, [h.agents.executor]);
    expect(
      await counted(
        `select count(*)::int as n from ${S}.activity_log
          where action = 'agent.budget_exceeded' and entity_id = $1`,
      ),
    ).toBe(1);
    expect(
      await counted(
        `select count(*)::int as n from ${S}.notifications
          where type = 'agent.budget_exceeded' and entity_id = $1`,
      ),
    ).toBe(1);
    const delivery = await h.raw.query<{ payload: Record<string, unknown> }>(
      `select payload from ${S}.webhook_deliveries where event = 'agent.budget_exceeded'`,
    );
    expect(delivery.rows).toHaveLength(1);
    expect(delivery.rows[0].payload).toMatchObject({
      event: "agent.budget_exceeded",
      data: {
        agent: { id: h.agents.executor, name: "Executor" },
        scope: "agent",
        budget_usd_month: 0.01,
      },
    });
  });
});
