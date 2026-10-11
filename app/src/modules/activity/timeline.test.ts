import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { entityTimeline } from "@/modules/activity/timeline";
import { decideApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import {
  createMilestone,
  requestMilestoneAcceptance,
  updateMilestone,
} from "@/modules/milestones/admin";
import { addMember } from "@/modules/workspace/settings";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";

const S = "proj_hub_gestao";
let h: TestHub;

beforeAll(async () => {
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});

const asOwner = () => ctxFor(h, h.owner_actor, "ui");

describe("linha do tempo das entidades (RF-43)", () => {
  it("o marco: criação, edição e o aceite pedido e decidido, do mais recente ao mais antigo", async () => {
    const m = await inTx(asOwner(), (t) =>
      createMilestone(t, "VIT", {
        title: "Marco com histórico",
        title_client: null,
        description_client: null,
        due_date: null,
        status: "planned",
        visibility: "internal",
        acceptance_criteria: [],
      }),
    );
    await inTx(asOwner(), (t) =>
      updateMilestone(t, m.id, {
        title: m.title,
        title_client: null,
        description_client: null,
        due_date: "2026-12-01",
        status: "delivered",
        visibility: "internal",
        acceptance_criteria: [],
      }),
    );
    const asked = await inTx(asOwner(), (t) =>
      requestMilestoneAcceptance(t, m.id),
    );
    await inTx(asOwner(), (t) =>
      decideApproval(t, asked.id, { decision: "approved" }),
    );

    const timeline = await inTx(asOwner(), (t) =>
      entityTimeline(t, "milestone", m.id),
    );
    expect(timeline).toMatchObject({
      label: `${m.code} · Marco com histórico`,
      projectCode: "VIT",
      backHref: "/projetos/VIT",
    });
    expect(timeline.items.map((i) => i.text)).toEqual([
      "aprovou o pedido",
      "pediu uma aprovação (Aceite de marco)",
      "mudou o status para Entregue e mudou a data para 01/12/2026",
      "criou o marco",
    ]);
    expect(timeline.items[0].actor?.id).toBe(h.owner);
  });

  it("o cliente e o projeto; quem não vê o projeto não vê o histórico", async () => {
    const client = (
      await h.raw.query<{ id: string }>(
        `select id from ${S}.clients where slug = 'clinica-exemplo'`,
      )
    ).rows[0].id;
    const timeline = await inTx(asOwner(), (t) =>
      entityTimeline(t, "client", client),
    );
    expect(timeline.backHref).toBe("/clientes");

    const project = await inTx(asOwner(), (t) =>
      entityTimeline(t, "project", h.vit),
    );
    expect(project.label).toMatch(/^VIT · /);

    const added = await inTx(asOwner(), (t) =>
      addMember(t, {
        name: "Sem Projeto",
        email: "sem.projeto.historico@harmony.test",
        role: "member",
      }),
    );
    const outsider: UserActor = {
      type: "user",
      id: added.profileId,
      scope: "internal",
      role: "member",
      workspaceId: h.ws,
      name: "Sem Projeto",
    };
    const err = await inTx(ctxFor(h, outsider, "ui"), (t) =>
      entityTimeline(t, "project", h.vit),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubError);
    expect([403, 404]).toContain((err as HubError).status);
    // Id que não existe ou fora do formato: 404.
    expect(
      await inTx(asOwner(), (t) => entityTimeline(t, "milestone", "x")).catch(
        (e: unknown) => (e as HubError).status,
      ),
    ).toBe(404);
  });
});
