import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import type { ModelFactory } from "@/lib/llm";
import { createAgent } from "@/modules/agents/service";
import { inTx } from "@/modules/context";
import { setAgentModel } from "@/modules/llm/agent-model";
import { importPlan } from "@/modules/sync/service";
import { createCredential } from "@/modules/llm/credentials";
import { count, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import type { PlanProposal } from "./proposal";
import { MAX_DOCUMENT, NO_PLANNER, proposePlan } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
let member: UserActor;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

const DOCUMENT =
  "O cliente quer um atendimento no WhatsApp que agende consultas sozinho, com um painel para a recepção acompanhar.";

const PROPOSAL: PlanProposal = {
  milestones: [
    {
      title: "Agendamento pelo WhatsApp",
      due_date: null,
      acceptance_criteria: ["O paciente agenda sem falar com a recepção"],
      client_title: "Seu agendamento automático",
      client_summary: "Seus pacientes marcam consulta pelo WhatsApp.",
      workstreams: [
        {
          title: "Fluxo de conversa",
          department: "agentes-e-automacoes",
          tasks: [{ title: "Escrever o fluxo de agendamento", subtasks: [] }],
        },
      ],
    },
  ],
  assumptions: ["A clínica já usa uma agenda com API?"],
};

beforeAll(async () => {
  process.env.HUB_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  h = await openTestHub();
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('lia@exemplo.com', 'Lia') returning id`,
    )
  ).rows[0];
  await h.raw.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'member')`,
    [h.ws, profile.id],
  );
  member = {
    type: "user",
    id: profile.id,
    scope: "internal",
    role: "member",
    workspaceId: h.ws,
    name: "Lia",
  };
});

afterAll(async () => {
  await h.db.close();
});

function answering(proposal: PlanProposal, seen: string[] = []): ModelFactory {
  return () =>
    new MockLanguageModelV4({
      doGenerate: async (options) => {
        const user = options.prompt.filter((m) => m.role === "user").at(-1);
        seen.push(
          (user?.content ?? [])
            .map((p) => (p.type === "text" ? p.text : ""))
            .join(""),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(proposal) }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: {
              total: 2000,
              noCache: 2000,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 800, text: 800, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
}

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

describe("Planejador (PL-11)", () => {
  it("falha fechada e só para quem cria marco", async () => {
    const seen: string[] = [];
    const ask = (ctx = asOwner(), document = DOCUMENT) =>
      proposePlan(
        ctx,
        { project: "VIT", document },
        { modelFor: answering(PROPOSAL, seen) },
      );
    expect(await ask()).toEqual({ ok: false, message: NO_PLANNER });
    expect(await ask(asOwner(), "curto")).toMatchObject({ ok: false });
    expect(await ask(asOwner(), "x".repeat(MAX_DOCUMENT + 1))).toMatchObject({
      ok: false,
    });
    // Pessoa da equipe sem permissão de marco: recusa (marco é do dono e da administração).
    expect(await status(ask(ctxFor(h, member, "ui")))).toBe(403);
    expect(seen).toEqual([]);

    // Liga o Planejador (chave de mentira; o modelo é sempre o simulado).
    const agent = await inTx(asOwner(), (t) =>
      createAgent(t, {
        name: "Planejador",
        kind: "internal",
        roles: ["PL-11"],
      }),
    );
    const credential = await inTx(asOwner(), (t) =>
      createCredential(t, {
        provider: "openai",
        label: "Chave de teste",
        key: "sk-openai-teste-fake-0000000000000000000000",
      }),
    );
    await inTx(asOwner(), (t) =>
      setAgentModel(t, agent.id, {
        provider: "openai",
        model: "modelo-de-teste",
        credential_id: credential.id,
        price_in: 3,
        price_out: 15,
        budget_usd_month: 5,
      }),
    );
  });

  it("propõe o plano em texto de plan.md, sem criar nada", async () => {
    const milestones = () =>
      count(
        h,
        `select count(*)::int as n from ${S}.milestones where project_id = $1`,
        [h.vit],
      );
    const before = await milestones();
    const seen: string[] = [];
    const result = await proposePlan(
      asOwner(),
      { project: "VIT", document: DOCUMENT },
      { modelFor: answering(PROPOSAL, seen) },
    );
    expect(result).toMatchObject({
      ok: true,
      counts: { milestones: 1, workstreams: 1, tasks: 1, subtasks: 0 },
      assumptions: ["A clínica já usa uma agenda com API?"],
      costUsd: (2000 * 3 + 800 * 15) / 1e6,
    });
    if (!result.ok) throw new Error(result.message);
    // O VIT do ambiente de teste já tem um marco: a proposta continua a numeração.
    expect(result.markdown).toMatch(/^# Plano de Atendimento com IA\n/);
    expect(result.markdown).toContain("## M2 — Agendamento pelo WhatsApp");
    expect(result.markdown).toContain(
      "Departamento sugerido: Agentes e Automações.",
    );
    expect(await milestones()).toBe(before);
    // A proposta entra na importação de sempre: a prévia mostra o que entraria.
    const preview = await inTx(asOwner(), (t) =>
      importPlan(t, {
        project: "VIT",
        markdown: result.markdown,
        dry_run: true,
      }),
    );
    expect(preview).toMatchObject({
      dry_run: true,
      summary: { milestones_created: 1, workstreams_created: 1, created: 1 },
    });
    expect(await milestones()).toBe(before);
    expect(seen[0]).toContain("MARCOS EXISTENTES:\n- M1 ·");
    expect(seen[0].split("\n").slice(-2)).toEqual(["DOCUMENTO:", DOCUMENT]);
    // A chamada ficou registrada com o prompt e a versão.
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.agent_runs where summary like 'Planejador · PL-11/propor@1 · VIT%'`,
      ),
    ).toBe(1);
  });

  it("proposta sem marco aproveitável vira recado, não texto vazio", async () => {
    expect(
      await proposePlan(
        asOwner(),
        { project: "VIT", document: DOCUMENT },
        {
          modelFor: answering({
            milestones: [
              {
                title: "   ",
                due_date: null,
                acceptance_criteria: [],
                client_title: null,
                client_summary: null,
                workstreams: [],
              },
            ],
            assumptions: [],
          }),
        },
      ),
    ).toMatchObject({ ok: false });
  });
});
