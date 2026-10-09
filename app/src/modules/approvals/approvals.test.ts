import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentActor } from "@/lib/db/actor";
import {
  decideApproval,
  getApproval,
  listApprovals,
  requestApproval,
} from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import { draftReport, listReports } from "@/modules/reports/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";

const S = "proj_hub_gestao";
let h: TestHub;
let kratos: AgentActor;

beforeAll(async () => {
  h = await openTestHub();
  kratos = await agentActor(h, h.keys.kratos);
});
afterAll(async () => {
  await h.db.close();
});

const asKratos = () => ctxFor(h, { ...kratos, actingRole: "GP-01" }, "mcp");
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

describe("aprovações", () => {
  it("o agente pede aceite de marco; o Fábio é avisado; repetir o pedido é conflito", async () => {
    const approval = await inTx(asKratos(), (t) =>
      requestApproval(t, {
        type: "milestone_acceptance",
        project: "VIT",
        milestone: "M1",
        title: "Aceite do M1: atendente no WhatsApp",
        summary: "Todas as frentes do marco concluídas, com evidência.",
      }),
    );
    expect(approval.status).toBe("pending");
    expect(approval.acting_role).toBe("GP-01");
    expect(approval.approver?.id).toBe(h.owner);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.notifications where entity_id = $1 and profile_id = $2`,
        [approval.id, h.owner],
      ),
    ).toBe(1);
    await expect(
      inTx(asKratos(), (t) =>
        requestApproval(t, {
          type: "milestone_acceptance",
          project: "VIT",
          milestone: "M1",
          title: "De novo",
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      extra: { approval_id: approval.id },
    });
  });

  it("o agente não decide, nem com escopo total", async () => {
    const all = await agentActor(h, h.keys.todos);
    const pending = (
      await inTx(asOwner(), (t) => listApprovals(t, { status: "pending" }))
    ).items[0];
    await expect(
      inTx(ctxFor(h, all), (t) =>
        decideApproval(t, pending.id, { decision: "approved" }),
      ),
    ).rejects.toMatchObject({ status: 403, extra: { human_only: true } });
  });

  it("o Fábio aprova e o marco fica aceito por ele", async () => {
    const pending = (
      await inTx(asOwner(), (t) =>
        listApprovals(t, { status: "pending", project: "VIT" }),
      )
    ).items.find((a) => a.type === "milestone_acceptance")!;
    const decided = await inTx(asOwner(), (t) =>
      decideApproval(t, pending.id, {
        decision: "approved",
        note: "Conferi no celular.",
      }),
    );
    expect(decided.status).toBe("approved");
    expect(decided.decided_by?.id).toBe(h.owner);
    expect(decided.effect).toMatchObject({
      applied: true,
      milestone_status: "accepted",
    });
    const m = await h.raw.query<{
      status: string;
      accepted_by_profile_id: string;
    }>(
      `select status, accepted_by_profile_id from ${S}.milestones where id = $1`,
      [h.vitMilestone],
    );
    expect(m.rows[0]).toEqual({
      status: "accepted",
      accepted_by_profile_id: h.owner,
    });
    await expect(
      inTx(asOwner(), (t) =>
        decideApproval(t, pending.id, { decision: "rejected" }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("frente visível ao cliente só com título para o cliente e com aprovação", async () => {
    await expect(
      inTx(asKratos(), (t) =>
        requestApproval(t, {
          type: "client_visibility",
          project: "VIT",
          workstream_id: h.vitWorkstream,
          title: "Mostrar o fluxo ao cliente",
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    const approval = await inTx(asKratos(), (t) =>
      requestApproval(t, {
        type: "client_visibility",
        project: "VIT",
        workstream_id: h.vitWorkstream,
        title: "Mostrar o fluxo ao cliente",
        payload: {
          title_client: "Como o seu atendimento vai funcionar",
          description_client:
            "Você acompanha aqui cada etapa do atendimento automático.",
        },
      }),
    );
    await inTx(asOwner(), (t) =>
      decideApproval(t, approval.id, { decision: "approved" }),
    );
    const w = await h.raw.query<{ visibility: string; title_client: string }>(
      `select visibility, title_client from ${S}.workstreams where id = $1`,
      [h.vitWorkstream],
    );
    expect(w.rows[0]).toEqual({
      visibility: "client",
      title_client: "Como o seu atendimento vai funcionar",
    });
  });

  it("quem pediu sempre vê o próprio pedido", async () => {
    const mine = await inTx(asKratos(), (t) =>
      listApprovals(t, { mine: true }),
    );
    expect(mine.items.length).toBeGreaterThanOrEqual(2);
    await expect(
      inTx(asKratos(), (t) => getApproval(t, mine.items[0].id)),
    ).resolves.toMatchObject({
      id: mine.items[0].id,
    });
  });
});

describe("relatórios", () => {
  it("rascunho vira aprovação; aprovado, o relatório é publicado", async () => {
    const draft = await inTx(asKratos(), (t) =>
      draftReport(t, {
        project: "VIT",
        period_start: "2026-10-05",
        period_end: "2026-10-09",
        audience: "client",
        body_md:
          "Nesta semana, você ganhou o atendimento automático no WhatsApp.",
      }),
    );
    expect(draft.report.published_at).toBeNull();
    expect(draft.approval.type).toBe("status_report");
    expect(draft.report.approval_id).toBe(draft.approval.id);

    await inTx(asOwner(), (t) =>
      decideApproval(t, draft.approval.id, { decision: "approved" }),
    );
    const reports = await inTx(asKratos(), (t) => listReports(t, "VIT"));
    expect(reports.items[0].published_at).not.toBeNull();
  });

  it("período invertido é recusado", async () => {
    await expect(
      inTx(asKratos(), (t) =>
        draftReport(t, {
          project: "VIT",
          period_start: "2026-10-09",
          period_end: "2026-10-05",
          audience: "internal",
          body_md: "x",
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
