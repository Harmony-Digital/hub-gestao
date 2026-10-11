import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { decideApproval, requestApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";

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

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

const approve = (id: string) =>
  inTx(asOwner(), (t) => decideApproval(t, id, { decision: "approved" }));

describe("aprovação com efeito automático (RF-25)", () => {
  it("marco proposto vira marco ao aprovar: planejado, com data e critérios", async () => {
    const asked = await inTx(asKratos(), (t) =>
      requestApproval(t, {
        type: "milestone_proposal",
        project: "VIT",
        title: "Novo marco: relatórios mensais",
        summary: "Falta um marco para os relatórios.",
        payload: {
          title: "Relatórios mensais",
          due_date: "2026-12-15",
          acceptance_criteria:
            "- Modelo aprovado\n- Primeiro relatório enviado",
        },
      }),
    );
    expect(asked.payload).toMatchObject({
      title: "Relatórios mensais",
      acceptance_criteria: ["Modelo aprovado", "Primeiro relatório enviado"],
    });
    const decided = await approve(asked.id);
    expect(decided.effect).toMatchObject({ applied: true });
    const code = decided.effect.milestone as string;
    const row = await h.raw.query<{
      title: string;
      due_date: string;
      status: string;
      visibility: string;
      acceptance_criteria: unknown;
    }>(
      `select title, due_date::text as due_date, status::text as status, visibility::text as visibility,
              acceptance_criteria
         from ${S}.milestones where project_id = $1 and code = $2`,
      [h.vit, code],
    );
    expect(row.rows[0]).toEqual({
      title: "Relatórios mensais",
      due_date: "2026-12-15",
      status: "planned",
      visibility: "internal",
      acceptance_criteria: [
        { text: "Modelo aprovado", done: false },
        { text: "Primeiro relatório enviado", done: false },
      ],
    });
  });

  it("replanejamento muda as datas e o motivo vai para o histórico de datas", async () => {
    const before = await h.raw.query<{ due_date: string | null }>(
      `select due_date::text as due_date from ${S}.milestones where id = $1`,
      [h.vitMilestone],
    );
    const asked = await inTx(asKratos(), (t) =>
      requestApproval(t, {
        type: "replan",
        project: "VIT",
        title: "Adiar o M1 em duas semanas",
        payload: {
          milestones: [{ code: "M1", due_date: "2026-11-30" }],
          reason: "Integração com o WhatsApp atrasou.",
        },
      }),
    );
    const decided = await approve(asked.id);
    expect(decided.effect).toEqual({
      applied: true,
      replanned: [
        { code: "M1", from: before.rows[0].due_date, to: "2026-11-30" },
      ],
    });
    const history = await h.raw.query<{ new_due: string; reason: string }>(
      `select new_due::text as new_due, reason_internal as reason
         from ${S}.milestone_date_history where milestone_id = $1
        order by id desc limit 1`,
      [h.vitMilestone],
    );
    expect(history.rows[0]).toEqual({
      new_due: "2026-11-30",
      reason: "Integração com o WhatsApp atrasou.",
    });
  });

  it("mudança de escopo troca título e critérios, mantendo o que já estava feito", async () => {
    await h.raw.query(
      `update ${S}.milestones set acceptance_criteria = $2::jsonb where id = $1`,
      [
        h.vitMilestone,
        JSON.stringify([
          { text: "Atendente responde no WhatsApp", done: true },
          { text: "Agenda integrada", done: false },
        ]),
      ],
    );
    const asked = await inTx(asKratos(), (t) =>
      requestApproval(t, {
        type: "scope_change",
        project: "VIT",
        title: "Escopo do M1 sem a agenda",
        payload: {
          milestones: [
            {
              code: "M1",
              title: "Atendente no WhatsApp (sem agenda)",
              acceptance_criteria: [
                "Atendente responde no WhatsApp",
                "Transferência para humano",
              ],
            },
          ],
        },
      }),
    );
    expect((await approve(asked.id)).effect).toEqual({
      applied: true,
      scope_changed: ["M1"],
    });
    const row = await h.raw.query<{
      title: string;
      acceptance_criteria: unknown;
    }>(`select title, acceptance_criteria from ${S}.milestones where id = $1`, [
      h.vitMilestone,
    ]);
    expect(row.rows[0]).toEqual({
      title: "Atendente no WhatsApp (sem agenda)",
      acceptance_criteria: [
        { text: "Atendente responde no WhatsApp", done: true },
        { text: "Transferência para humano", done: false },
      ],
    });
  });

  it("mensagem externa aprovada vai ao canal do cliente, em nome de quem aprovou", async () => {
    const asked = await inTx(asKratos(), (t) =>
      requestApproval(t, {
        type: "external_message",
        project: "VIT",
        title: "Avisar o cliente da nova data",
        payload: {
          body: "Olá! A entrega do atendimento no WhatsApp passa para 30/11.",
        },
      }),
    );
    expect(asked.payload.checks).toEqual([]);
    const decided = await approve(asked.id);
    const comment = await h.raw.query<{
      visibility: string;
      author_type: string;
      author_id: string;
      body_md: string;
    }>(
      `select visibility::text as visibility, author_type::text as author_type, author_id, body_md
         from ${S}.comments where id = $1`,
      [decided.effect.client_message],
    );
    expect(comment.rows[0]).toEqual({
      visibility: "client",
      author_type: "user",
      author_id: h.owner,
      body_md: "Olá! A entrega do atendimento no WhatsApp passa para 30/11.",
    });
  });

  it("pedido fora do formato é recusado já no pedido, com o formato certo", async () => {
    const ask = (
      type: "replan" | "scope_change" | "external_message",
      payload: Record<string, unknown>,
    ) =>
      status(
        inTx(asKratos(), (t) =>
          requestApproval(t, {
            type,
            project: "VIT",
            title: "Pedido",
            payload,
          }),
        ),
      );
    expect(await ask("replan", {})).toBe(400);
    expect(
      await ask("replan", { milestones: [{ code: "M1", due_date: "30/11" }] }),
    ).toBe(400);
    expect(
      await ask("replan", {
        milestones: [{ code: "M99", due_date: "2026-11-30" }],
      }),
    ).toBe(422);
    expect(await ask("scope_change", { milestones: [{ code: "M1" }] })).toBe(
      400,
    );
    expect(await ask("external_message", { body: "  " })).toBe(400);
    await expect(
      inTx(asKratos(), (t) =>
        requestApproval(t, {
          type: "replan",
          project: "VIT",
          title: "X",
          payload: {},
        }),
      ),
    ).rejects.toMatchObject({
      detail: expect.stringContaining("payload.milestones"),
    });
  });

  it("pedido de antes do formato: aprovar registra a decisão e nada muda sozinho", async () => {
    const asked = await inTx(asKratos(), (t) =>
      requestApproval(t, {
        type: "replan",
        project: "VIT",
        title: "Pedido antigo",
        payload: { milestones: [{ code: "M1", due_date: "2026-12-20" }] },
      }),
    );
    // Como era gravado antes do formato de cada tipo: sem a lista de marcos.
    await h.raw.query(
      `update ${S}.approvals set payload = '{}'::jsonb where id = $1`,
      [asked.id],
    );
    const before = await h.raw.query<{ due_date: string | null }>(
      `select due_date::text as due_date from ${S}.milestones where id = $1`,
      [h.vitMilestone],
    );
    const decided = await approve(asked.id);
    expect(decided).toMatchObject({
      status: "approved",
      effect: { applied: false },
    });
    const after = await h.raw.query<{ due_date: string | null }>(
      `select due_date::text as due_date from ${S}.milestones where id = $1`,
      [h.vitMilestone],
    );
    expect(after.rows[0].due_date).toBe(before.rows[0].due_date);
  });

  it("marco aceito depois do pedido: a decisão para e explica", async () => {
    const asked = await inTx(asKratos(), (t) =>
      requestApproval(t, {
        type: "replan",
        project: "VIT",
        title: "Mexer no M1",
        payload: { milestones: [{ code: "M1", due_date: "2027-01-10" }] },
      }),
    );
    // O dono aceita o M1 pelo caminho de sempre (pedido de aceite aprovado).
    const acceptance = await inTx(asKratos(), (t) =>
      requestApproval(t, {
        type: "milestone_acceptance",
        project: "VIT",
        milestone: "M1",
        title: "Aceite do M1",
      }),
    );
    await approve(acceptance.id);
    expect(await status(approve(asked.id))).toBe(422);
    const still = await h.raw.query<{ status: string }>(
      `select status::text as status from ${S}.approvals where id = $1`,
      [asked.id],
    );
    expect(still.rows[0].status).toBe("pending");
  });
});
