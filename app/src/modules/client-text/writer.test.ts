import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModelFactory } from "@/lib/llm";
import { createAgent } from "@/modules/agents/service";
import { decideApproval, requestApproval } from "@/modules/approvals/service";
import { inTx, type Ctx } from "@/modules/context";
import { systemActor, tick } from "@/modules/jobs/service";
import { setAgentModel } from "@/modules/llm/agent-model";
import { createCredential } from "@/modules/llm/credentials";
import { draftReport } from "@/modules/reports/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { HubError } from "@/lib/errors";
import {
  NO_WRITER,
  REWRITE_JOB,
  rewriteForClient,
  suggestWorkstreamClientText,
  type RewriteOutput,
} from "./writer";

const S = "proj_hub_gestao";
let h: TestHub;
let writerId: string;

const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asSystem = (): Ctx => ({
  db: h.db,
  actor: systemActor(h.ws),
  source: "cron",
  requestId: "teste-rc12",
});
const asKratos = async () =>
  ctxFor(h, await agentActor(h, h.keys.kratos), "mcp");

function answering(out: RewriteOutput, seen: string[] = []): ModelFactory {
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
          content: [{ type: "text", text: JSON.stringify(out) }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: {
              total: 800,
              noCache: 800,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 300, text: 300, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
}

const failing: ModelFactory = () =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("provedor fora do ar");
    },
  });

let period = 0;
async function clientDraft(body_md: string) {
  // Um período por rascunho: a versão nova de um mesmo período substitui a anterior.
  period += 1;
  const day = String(period).padStart(2, "0");
  return inTx(await asKratos(), (t) =>
    draftReport(t, {
      project: "VIT",
      period_start: `2026-09-${day}`,
      period_end: `2026-09-${day}`,
      audience: "client",
      body_md,
    }),
  );
}

const queued = async (approvalId: string) =>
  (
    await h.raw.query(
      `select 1 from ${S}.jobs where type = $1 and payload ->> 'approval_id' = $2`,
      [REWRITE_JOB, approvalId],
    )
  ).rows.length;

beforeAll(async () => {
  process.env.HUB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  h = await openTestHub();
});

afterAll(async () => {
  await h.db.close();
});

describe("Redator do Cliente (RC-12): reescrita", () => {
  it("falha fechada: sem agente RC-12, nada vai para a fila e o pedido segue igual", async () => {
    const draft = await clientDraft("A HUB-57 ficou pronta.");
    expect(await queued(draft.approval.id)).toBe(0);
    expect(
      await rewriteForClient(asSystem(), draft.approval.id, {
        modelFor: answering({
          text: "x",
          title: null,
          description: null,
          notes: null,
        }),
      }),
    ).toEqual({ status: "skipped", reason: "sem Redator do Cliente ligado" });
  });

  it("com o RC-12 ligado, reescreve o relatório numa versão nova e guarda a original", async () => {
    const agent = await inTx(asOwner(), (t) =>
      createAgent(t, {
        name: "Redator do Cliente",
        kind: "internal",
        roles: ["RC-12"],
      }),
    );
    writerId = agent.id;
    const credential = await inTx(asOwner(), (t) =>
      createCredential(t, {
        provider: "anthropic",
        label: "Chave de teste",
        key: "sk-ant-teste-fake-000000000000000000000000",
      }),
    );
    await inTx(asOwner(), (t) =>
      setAgentModel(t, agent.id, {
        provider: "anthropic",
        model: "modelo-de-teste",
        credential_id: credential.id,
        price_in: 3,
        price_out: 15,
        budget_usd_month: 5,
      }),
    );

    const original = "Concluímos a HUB-57: o Kratos ligou o atendimento.";
    const draft = await clientDraft(original);
    expect(await queued(draft.approval.id)).toBe(1);

    const seen: string[] = [];
    const rewritten =
      "Nesta semana, você ganhou o atendimento automático no WhatsApp.";
    const result = await rewriteForClient(asSystem(), draft.approval.id, {
      modelFor: answering(
        {
          text: rewritten,
          title: null,
          description: null,
          notes: "Tirei o código da tarefa e o nome do agente.",
        },
        seen,
      ),
    });
    expect(result).toEqual({ status: "rewritten", issues: 0 });
    // A IA recebeu o texto e os pontos que a verificação achou.
    expect(seen[0]).toContain("TIPO: relatório");
    expect(seen[0]).toContain("- código de tarefa HUB-57");
    expect(seen[0]).toContain("- nome de agente Kratos");
    expect(seen[0]).toContain(original);

    const approval = await h.raw.query<{
      entity_id: string;
      payload: Record<string, unknown>;
      summary: string;
    }>(`select entity_id, payload, summary from ${S}.approvals where id = $1`, [
      draft.approval.id,
    ]);
    const row = approval.rows[0];
    expect(row.payload).toMatchObject({
      report_body: rewritten,
      original_body: original,
      checks: [],
      rewritten_by: "RC-12",
      rewrite_notes: "Tirei o código da tarefa e o nome do agente.",
    });
    expect(row.summary).toMatch(
      /^Versão 2, Reescrito pelo Redator do Cliente \(RC-12\)\. A versão 1/,
    );
    const versions = await h.raw.query<{
      id: string;
      version: number;
      body_md: string;
      by: string | null;
    }>(
      `select id, version, body_md, generated_by_agent_id as by from ${S}.status_reports
        where approval_id = $1 order by version`,
      [draft.approval.id],
    );
    expect(versions.rows.map((r) => [r.version, r.body_md])).toEqual([
      [1, original],
      [2, rewritten],
    ]);
    expect(versions.rows[1].by).toBe(writerId);
    expect(row.entity_id).toBe(versions.rows[1].id);

    // De novo: já reescrito, nada muda.
    expect(
      await rewriteForClient(asSystem(), draft.approval.id, {
        modelFor: answering({
          text: "outra",
          title: null,
          description: null,
          notes: null,
        }),
      }),
    ).toEqual({ status: "skipped", reason: "já reescrito" });

    // Aprovado, publica a versão do Redator; a original fica guardada, sem publicar.
    await inTx(asOwner(), (t) =>
      decideApproval(t, draft.approval.id, { decision: "approved" }),
    );
    const published = await h.raw.query<{ version: number; pub: boolean }>(
      `select version, published_at is not null as pub from ${S}.status_reports
        where approval_id = $1 order by version`,
      [draft.approval.id],
    );
    expect(published.rows).toEqual([
      { version: 1, pub: false },
      { version: 2, pub: true },
    ]);
  });

  it("o texto reescrito também passa pela verificação; pedido decidido ou IA fora: nada muda", async () => {
    const leaking = await clientDraft("Texto com a HUB-58.");
    const still = await rewriteForClient(asSystem(), leaking.approval.id, {
      modelFor: answering({
        text: "Você ganhou a HUB-58.",
        title: null,
        description: null,
        notes: null,
      }),
    });
    expect(still).toEqual({ status: "rewritten", issues: 1 });
    const checks = await h.raw.query<{ checks: unknown }>(
      `select payload -> 'checks' as checks from ${S}.approvals where id = $1`,
      [leaking.approval.id],
    );
    expect(checks.rows[0].checks).toEqual([
      { kind: "task_code", term: "HUB-58" },
    ]);

    const decided = await clientDraft("Texto para recusar.");
    await inTx(asOwner(), (t) =>
      decideApproval(t, decided.approval.id, { decision: "rejected" }),
    );
    expect(
      await rewriteForClient(asSystem(), decided.approval.id, {
        modelFor: answering({
          text: "x",
          title: null,
          description: null,
          notes: null,
        }),
      }),
    ).toEqual({ status: "skipped", reason: "pedido já decidido" });

    const down = await clientDraft("Texto com a IA fora do ar.");
    const result = await rewriteForClient(asSystem(), down.approval.id, {
      modelFor: failing,
    });
    expect(result.status).toBe("skipped");
    const untouched = await h.raw.query<{ payload: Record<string, unknown> }>(
      `select payload from ${S}.approvals where id = $1`,
      [down.approval.id],
    );
    expect(untouched.rows[0].payload.rewritten_by).toBeUndefined();
  });

  it("frente para o cliente: o título e a descrição são reescritos; aprovar usa o texto novo", async () => {
    const approval = await inTx(await asKratos(), (t) =>
      requestApproval(t, {
        project: "VIT",
        type: "client_visibility",
        title: "Mostrar a frente ao cliente",
        workstream_id: h.vitWorkstream,
        payload: {
          title_client: "Fluxo do bot (HUB-60)",
          description_client: "Configurado pelo Kratos.",
        },
      }),
    );
    expect(await queued(approval.id)).toBe(1);
    // Os jobs dos rascunhos de antes já foram conferidos à mão: só este roda no relógio.
    await h.raw.query(
      `update ${S}.jobs set status = 'done'
        where type = $1 and payload ->> 'approval_id' <> $2`,
      [REWRITE_JOB, approval.id],
    );
    // Pelo relógio, como na VPS.
    const ran = await tick(h.db, h.ws, {
      llm: {
        modelFor: answering({
          text: null,
          title: "Atendimento pelo WhatsApp",
          description:
            "As conversas com seus pacientes, do primeiro contato ao agendamento.",
          notes: "Título no tom do cliente.",
        }),
      },
    });
    expect(ran.ran.find((j) => j.type === REWRITE_JOB)?.result).toEqual({
      status: "rewritten",
      issues: 0,
    });
    const row = await h.raw.query<{ payload: Record<string, unknown> }>(
      `select payload from ${S}.approvals where id = $1`,
      [approval.id],
    );
    expect(row.rows[0].payload).toMatchObject({
      title_client: "Atendimento pelo WhatsApp",
      original_title_client: "Fluxo do bot (HUB-60)",
      original_description_client: "Configurado pelo Kratos.",
      rewritten_by: "RC-12",
      checks: [],
    });
    await inTx(asOwner(), (t) =>
      decideApproval(t, approval.id, { decision: "approved" }),
    );
    const ws = await h.raw.query<{ title_client: string; visibility: string }>(
      `select title_client, visibility::text as visibility from ${S}.workstreams where id = $1`,
      [h.vitWorkstream],
    );
    expect(ws.rows[0]).toEqual({
      title_client: "Atendimento pelo WhatsApp",
      visibility: "client",
    });
  });
});

describe("Redator do Cliente (RC-12): mensagem externa e marco proposto", () => {
  /** Só o job deste pedido roda no relógio (os de antes já foram conferidos). */
  async function runOnly(approvalId: string, out: RewriteOutput) {
    await h.raw.query(
      `update ${S}.jobs set status = 'done'
        where type = $1 and payload ->> 'approval_id' <> $2`,
      [REWRITE_JOB, approvalId],
    );
    const ran = await tick(h.db, h.ws, { llm: { modelFor: answering(out) } });
    return ran.ran.find((j) => j.type === REWRITE_JOB)?.result;
  }
  const payloadOf = async (id: string) =>
    (
      await h.raw.query<{ payload: Record<string, unknown> }>(
        `select payload from ${S}.approvals where id = $1`,
        [id],
      )
    ).rows[0].payload;

  it("a mensagem para o canal do cliente é reescrita; aprovar manda o texto novo", async () => {
    const approval = await inTx(await asKratos(), (t) =>
      requestApproval(t, {
        project: "VIT",
        type: "external_message",
        title: "Avisar o cliente da agenda",
        payload: { body: "Oi! A HUB-61 ficou pronta e o Kratos testou." },
      }),
    );
    expect(await queued(approval.id)).toBe(1);
    expect(
      await runOnly(approval.id, {
        text: "Olá! A integração com a sua agenda ficou pronta e já foi testada.",
        title: null,
        description: null,
        notes: "Tirei o código da tarefa e o nome do agente.",
      }),
    ).toEqual({ status: "rewritten", issues: 0 });
    expect(await payloadOf(approval.id)).toMatchObject({
      body: "Olá! A integração com a sua agenda ficou pronta e já foi testada.",
      original_body: "Oi! A HUB-61 ficou pronta e o Kratos testou.",
      rewritten_by: "RC-12",
      checks: [],
    });
    await inTx(asOwner(), (t) =>
      decideApproval(t, approval.id, { decision: "approved" }),
    );
    const sent = await h.raw.query<{ body_md: string }>(
      `select body_md from ${S}.comments where body_md like 'Olá! A integração%'`,
    );
    expect(sent.rows).toHaveLength(1);
    expect(
      (
        await h.raw.query(
          `select 1 from ${S}.comments where body_md like '%HUB-61%'`,
        )
      ).rows,
    ).toEqual([]);
  });

  it("o marco proposto com título para o cliente é reescrito; sem esse título, não vai para a fila", async () => {
    const plain = await inTx(await asKratos(), (t) =>
      requestApproval(t, {
        project: "VIT",
        type: "milestone_proposal",
        title: "Marco interno",
        payload: { title: "Ajustes internos" },
      }),
    );
    expect(await queued(plain.id)).toBe(0);

    const approval = await inTx(await asKratos(), (t) =>
      requestApproval(t, {
        project: "VIT",
        type: "milestone_proposal",
        title: "Marco de relatórios",
        payload: {
          title: "Relatórios",
          due_date: "2026-12-01",
          title_client: "Relatórios do Kratos (HUB-70)",
        },
      }),
    );
    expect(await queued(approval.id)).toBe(1);
    expect(
      await runOnly(approval.id, {
        text: null,
        title: "Relatórios semanais do atendimento",
        description: "Um resumo por semana do que seus pacientes pediram.",
        notes: null,
      }),
    ).toEqual({ status: "rewritten", issues: 0 });
    expect(await payloadOf(approval.id)).toMatchObject({
      title_client: "Relatórios semanais do atendimento",
      original_title_client: "Relatórios do Kratos (HUB-70)",
      rewritten_by: "RC-12",
    });
    await inTx(asOwner(), (t) =>
      decideApproval(t, approval.id, { decision: "approved" }),
    );
    const created = await h.raw.query<{ title_client: string }>(
      `select title_client from ${S}.milestones where title = 'Relatórios'`,
    );
    expect(created.rows).toEqual([
      { title_client: "Relatórios semanais do atendimento" },
    ]);
  });
});

describe("Redator do Cliente (RC-12): sugestão na janela da frente", () => {
  it("sugere o título e a descrição, sem gravar nada, e confere a sugestão de novo", async () => {
    const seen: string[] = [];
    const before = Number(
      (
        await h.raw.query<{ n: number }>(
          `select count(*)::int as n from ${S}.approvals`,
        )
      ).rows[0].n,
    );
    const result = await suggestWorkstreamClientText(
      asOwner(),
      {
        project: "VIT",
        title: "Fluxo de atendimento (HUB-3)",
        description: "Ligar o n8n ao WhatsApp.",
      },
      {
        modelFor: answering(
          {
            text: null,
            title: "Atendimento automático no WhatsApp",
            description:
              "Seus pacientes marcam sozinhos, e o Kratos avisa a equipe.",
            notes: "Tirei o código da tarefa e o nome da ferramenta.",
          },
          seen,
        ),
      },
    );
    expect(result).toMatchObject({
      ok: true,
      title: "Atendimento automático no WhatsApp",
      notes: "Tirei o código da tarefa e o nome da ferramenta.",
    });
    // O nome do agente que sobrou na sugestão volta como alerta.
    expect(result.ok && result.issues.map((i) => i.term)).toContain("Kratos");
    expect(seen[0]).toContain("TIPO: frente");
    expect(seen[0]).toContain("código de tarefa HUB-3");
    // Nada foi gravado além da execução da IA, ligada ao projeto.
    expect(
      Number(
        (
          await h.raw.query<{ n: number }>(
            `select count(*)::int as n from ${S}.approvals`,
          )
        ).rows[0].n,
      ),
    ).toBe(before);
    expect(
      (
        await h.raw.query(
          `select 1 from ${S}.agent_runs where agent_id = $1 and project_id = $2 and summary like '%· tela'`,
          [writerId, h.vit],
        )
      ).rows.length,
    ).toBe(1);
  });

  it("só quem decide a visibilidade pede; sem Redator ligado, a tela diz o que falta", async () => {
    await expect(
      suggestWorkstreamClientText(await asKratos(), {
        project: "VIT",
        title: "Fluxo",
        description: null,
      }),
    ).rejects.toSatisfy((e) => e instanceof HubError && e.status === 403);
    await h.raw.query(
      `update ${S}.agents set status = 'paused' where id = $1`,
      [writerId],
    );
    expect(
      await suggestWorkstreamClientText(asOwner(), {
        project: "VIT",
        title: "Fluxo",
        description: null,
      }),
    ).toEqual({ ok: false, message: NO_WRITER });
    await h.raw.query(
      `update ${S}.agents set status = 'active' where id = $1`,
      [writerId],
    );
  });
});
