import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import { draftReport } from "@/modules/reports/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";

const S = "proj_hub_gestao";
let h: TestHub;

beforeAll(async () => {
  h = await openTestHub();
  await h.raw.query(
    `insert into ${S}.clients (workspace_id, slug, name) values ($1, 'padaria', 'Padaria São José')`,
    [h.ws],
  );
});

afterAll(async () => {
  await h.db.close();
});

const asKratos = async () =>
  ctxFor(h, await agentActor(h, h.keys.kratos), "mcp");

describe("verificação do texto para o cliente nos pedidos (RC-12)", () => {
  it("rascunho de status para o cliente volta com os alertas, e o pedido também", async () => {
    const result = await inTx(await asKratos(), (t) =>
      draftReport(t, {
        project: "VIT",
        period_start: "2026-10-05",
        period_end: "2026-10-09",
        audience: "client",
        body_md:
          "O Kratos fechou a HUB-57 (commit 3f9a2c1), como fizemos na Padaria São José.",
      }),
    );
    expect(result.checks.map((c) => c.text)).toEqual([
      "código de tarefa HUB-57",
      "código de commit 3f9a2c1",
      "nome de agente Kratos",
      "nome de outro cliente Padaria São José",
    ]);
    expect(result.approval.summary).toMatch(/achou 4 pontos para revisar/);
    expect(result.approval.payload).toMatchObject({
      audience: "client",
      report_body:
        "O Kratos fechou a HUB-57 (commit 3f9a2c1), como fizemos na Padaria São José.",
      checks: [
        { kind: "task_code", term: "HUB-57" },
        { kind: "commit", term: "3f9a2c1" },
        { kind: "agent", term: "Kratos" },
        { kind: "other_client", term: "Padaria São José" },
      ],
    });
  });

  it("relatório interno não passa pela verificação, mas o texto vai junto para a decisão", async () => {
    const result = await inTx(await asKratos(), (t) =>
      draftReport(t, {
        project: "VIT",
        period_start: "2026-10-05",
        period_end: "2026-10-09",
        audience: "internal",
        body_md: "HUB-57 fechada pelo Kratos.",
      }),
    );
    expect(result.checks).toEqual([]);
    expect(result.approval.payload).toEqual({
      audience: "internal",
      report_body: "HUB-57 fechada pelo Kratos.",
    });
  });

  it("a versão nova substitui a anterior ainda pendente do mesmo período", async () => {
    const draft = (body_md: string) =>
      asKratos().then((ctx) =>
        inTx(ctx, (t) =>
          draftReport(t, {
            project: "VIT",
            period_start: "2026-10-12",
            period_end: "2026-10-16",
            audience: "client",
            body_md,
          }),
        ),
      );
    const v1 = await draft("Primeira versão.");
    const v2 = await draft("Segunda versão, revisada.");
    expect(v2.report.version).toBe(v1.report.version + 1);
    const status = await h.raw.query<{ id: string; status: string }>(
      `select id, status::text as status from ${S}.approvals where id = any($1::uuid[])`,
      [[v1.approval.id, v2.approval.id]],
    );
    expect(
      Object.fromEntries(status.rows.map((r) => [r.id, r.status])),
    ).toEqual({
      [v1.approval.id]: "cancelled",
      [v2.approval.id]: "pending",
    });
    // As duas versões ficam guardadas.
    const versions = await h.raw.query<{ version: number }>(
      `select version from ${S}.status_reports
        where period_start = '2026-10-12' and audience = 'client' order by version`,
    );
    expect(versions.rows.map((r) => r.version)).toEqual([1, 2]);
  });

  it("mostrar frente ao cliente: o Hub confere o texto proposto e ignora alertas vindos de fora", async () => {
    const approval = await inTx(await asKratos(), (t) =>
      requestApproval(t, {
        project: "VIT",
        type: "client_visibility",
        title: "Mostrar a frente ao cliente",
        workstream_id: h.vitWorkstream,
        payload: {
          title_client: "Fluxo montado pelo Codex",
          description_client: "Sem pendências.",
          checks: [],
          report_body: "texto forjado",
          rewritten_by: "RC-12",
          original_title_client: "forjado",
          rewrite_notes: "forjado",
        },
      }),
    );
    expect(approval.payload).toEqual({
      title_client: "Fluxo montado pelo Codex",
      description_client: "Sem pendências.",
      checks: [{ kind: "tool", term: "Codex" }],
    });
  });
});
