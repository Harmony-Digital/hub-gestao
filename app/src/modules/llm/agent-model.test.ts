import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { providerModels, setAgentModel } from "./agent-model";
import { createCredential, revokeCredential } from "./credentials";

const S = "proj_hub_gestao";
// Chaves de mentira, só para o teste.
const FAKE = {
  anthropic: "sk-ant-teste-fake-0000000000000000000000AAAA",
  openai: "sk-openai-teste-fake-00000000000000000000BBBB",
  xai: "xai-teste-fake-0000000000000000000000000CCCC",
};
let h: TestHub;
const ids = {} as Record<keyof typeof FAKE, string>;

beforeAll(async () => {
  process.env.HUB_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  h = await openTestHub();
  for (const provider of ["anthropic", "openai", "xai"] as const) {
    ids[provider] = (
      await inTx(owner(), (t) =>
        createCredential(t, {
          provider,
          label: `Chave ${provider}`,
          key: FAKE[provider],
        }),
      )
    ).id;
  }
});
afterAll(async () => {
  await h.db.close();
});

function owner() {
  return ctxFor(h, h.owner_actor, "ui");
}
const as = (role: UserActor["role"]) =>
  ctxFor(h, { ...h.owner_actor, role }, "ui");

async function status(promise: Promise<unknown>): Promise<number> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HubError);
  return (err as HubError).status;
}

const model = (over: Record<string, unknown> = {}) => ({
  provider: "anthropic" as const,
  model: "claude-modelo-de-teste",
  credential_id: ids.anthropic,
  price_in: 3,
  price_out: 15,
  budget_usd_month: 20,
  ...over,
});

describe("modelo de IA do agente", () => {
  it("o dono escolhe provedor, modelo, chave, preços e teto; tudo no histórico, sem a chave", async () => {
    const changed = await inTx(owner(), (t) =>
      setAgentModel(t, h.agents.kratos, model()),
    );
    expect(changed.sort()).toEqual(
      [
        "budget_usd_month",
        "credential",
        "model",
        "price_in",
        "price_out",
        "provider",
      ].sort(),
    );
    const row = await h.raw.query<{
      llm_provider: string;
      llm_model: string;
      llm_credential_id: string;
      budget: string;
      config: Record<string, unknown>;
    }>(
      `select llm_provider::text, llm_model, llm_credential_id, budget_usd_month::text as budget, config
         from ${S}.agents where id = $1`,
      [h.agents.kratos],
    );
    expect(row.rows[0]).toMatchObject({
      llm_provider: "anthropic",
      llm_model: "claude-modelo-de-teste",
      llm_credential_id: ids.anthropic,
    });
    expect(Number(row.rows[0].budget)).toBe(20);
    expect(row.rows[0].config).toMatchObject({
      llm_price_in: 3,
      llm_price_out: 15,
    });
    const log = await h.raw.query<{ after: unknown }>(
      `select after from ${S}.activity_log
        where action = 'agent.model_changed' and entity_id = $1`,
      [h.agents.kratos],
    );
    expect(JSON.stringify(log.rows)).toContain("Chave anthropic");
    expect(JSON.stringify(log.rows)).not.toContain(FAKE.anthropic);

    // Sem mudança, nada grava.
    expect(
      await inTx(owner(), (t) => setAgentModel(t, h.agents.kratos, model())),
    ).toEqual([]);
    // Desligar limpa provedor, modelo e chave.
    expect(
      await inTx(owner(), (t) =>
        setAgentModel(t, h.agents.kratos, { off: true }),
      ),
    ).toEqual(["off"]);
    const off = await h.raw.query<{ llm_provider: string | null }>(
      `select llm_provider::text from ${S}.agents where id = $1`,
      [h.agents.kratos],
    );
    expect(off.rows[0].llm_provider).toBeNull();
  });

  it("recusa chave de outro provedor ou revogada, e quem não é o dono", async () => {
    expect(
      await status(
        inTx(owner(), (t) =>
          setAgentModel(
            t,
            h.agents.kratos,
            model({ provider: "openai", credential_id: ids.anthropic }),
          ),
        ),
      ),
    ).toBe(422);
    await inTx(owner(), (t) => revokeCredential(t, ids.xai));
    expect(
      await status(
        inTx(owner(), (t) =>
          setAgentModel(
            t,
            h.agents.kratos,
            model({ provider: "xai", credential_id: ids.xai }),
          ),
        ),
      ),
    ).toBe(422);
    expect(
      await status(
        inTx(as("admin"), (t) => setAgentModel(t, h.agents.kratos, model())),
      ),
    ).toBe(403);
  });

  it("busca os modelos no provedor com a chave certa, sem expor a chave", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: init?.headers as Record<string, string> });
      return new Response(
        JSON.stringify({ data: [{ id: "modelo-b" }, { id: "modelo-a" }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    expect(await providerModels(owner(), ids.anthropic, fakeFetch)).toEqual({
      ok: true,
      models: ["modelo-a", "modelo-b"],
    });
    expect(await providerModels(owner(), ids.openai, fakeFetch)).toEqual({
      ok: true,
      models: ["modelo-a", "modelo-b"],
    });
    expect(seen[0]).toMatchObject({
      url: "https://api.anthropic.com/v1/models?limit=100",
      headers: {
        "x-api-key": FAKE.anthropic,
        "anthropic-version": "2023-06-01",
      },
    });
    expect(seen[1]).toMatchObject({
      url: "https://api.openai.com/v1/models",
      headers: { authorization: `Bearer ${FAKE.openai}` },
    });
    const refused = (async () =>
      new Response("{}", { status: 401 })) as unknown as typeof fetch;
    expect(await providerModels(owner(), ids.openai, refused)).toEqual({
      ok: false,
      message: "O provedor recusou a chave.",
    });
    expect(await providerModels(owner(), ids.xai, fakeFetch)).toEqual({
      ok: false,
      message: "A chave foi revogada.",
    });
    expect(
      await status(providerModels(as("admin"), ids.openai, fakeFetch)),
    ).toBe(403);
  });
});
