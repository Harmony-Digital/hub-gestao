import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { updateMilestone } from "@/modules/milestones/admin";
import {
  getMilestoneDetail,
  getMilestoneDetailByCode,
} from "@/modules/milestones/dates";
import { getMilestone } from "@/modules/milestones/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";

let h: TestHub;

beforeAll(async () => {
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});

const asOwner = () => ctxFor(h, h.owner_actor, "ui");

describe("histórico de datas do marco (RF-11)", () => {
  it("cada mudança de data vem com a de antes, a nova, o motivo e quem mudou", async () => {
    const m = await inTx(asOwner(), (t) => getMilestone(t, h.vitMilestone));
    const editable = {
      title: m.title,
      title_client: m.title_client,
      description_client: m.description_client,
      status: m.status as "planned" | "in_progress" | "delivered",
      visibility: m.visibility,
      acceptance_criteria: m.acceptance_criteria,
    };
    await inTx(asOwner(), (t) =>
      updateMilestone(t, m.id, {
        ...editable,
        due_date: "2026-11-20",
        date_reason: "A clínica pediu mais uma semana.",
      }),
    );
    await inTx(asOwner(), (t) =>
      updateMilestone(t, m.id, { ...editable, due_date: "2026-11-27" }),
    );

    const detail = await inTx(asOwner(), (t) =>
      getMilestoneDetail(t, h.vitMilestone),
    );
    expect(detail.code).toBe("M1");
    expect(detail.date_history.slice(0, 2)).toEqual([
      {
        at: expect.any(String),
        from: "2026-11-20",
        to: "2026-11-27",
        reason: null,
        by: { type: "user", id: h.owner, name: expect.any(String) },
      },
      {
        at: expect.any(String),
        from: m.due_date,
        to: "2026-11-20",
        reason: "A clínica pediu mais uma semana.",
        by: { type: "user", id: h.owner, name: expect.any(String) },
      },
    ]);

    // Pelo código, como o MCP pede; o agente com o projeto lê.
    const kratos = await agentActor(h, h.keys.kratos);
    const byCode = await inTx(ctxFor(h, kratos, "mcp"), (t) =>
      getMilestoneDetailByCode(t, "VIT", "M1"),
    );
    expect(byCode.date_history[0].to).toBe("2026-11-27");
    const err = await inTx(ctxFor(h, kratos, "mcp"), (t) =>
      getMilestoneDetailByCode(t, "VIT", "M99"),
    ).catch((e: unknown) => e);
    expect((err as HubError).status).toBe(404);
  });
});
