import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentActor, UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { decideApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import { setWorkstreamVisibility } from "@/modules/workstreams/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";
import {
  createMilestone,
  requestMilestoneAcceptance,
  updateMilestone,
  type CreateMilestoneInput,
} from "./admin";

const S = "proj_hub_gestao";
let h: TestHub;
let member: UserActor;
let agent: AgentActor;

const asOwner = () => ctxFor(h, h.owner_actor, "ui");

function milestone(
  over: Partial<CreateMilestoneInput> = {},
): CreateMilestoneInput {
  return {
    title: "Painel da recepção",
    title_client: "Painel para a sua recepção",
    description_client: null,
    due_date: "2026-11-30",
    status: "planned",
    visibility: "client",
    acceptance_criteria: [
      { text: "Fila do dia na tela", done: true },
      { text: "Aviso de chegada", done: false },
    ],
    ...over,
  };
}

async function hubError(promise: Promise<unknown>): Promise<HubError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HubError);
  return err as HubError;
}

beforeAll(async () => {
  h = await openTestHub();
  agent = await agentActor(h, h.keys.todos);
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('equipe2@exemplo.com', 'Equipe Dois') returning id`,
    )
  ).rows[0];
  await h.raw.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'member')`,
    [h.ws, profile.id],
  );
  await h.raw.query(
    `insert into ${S}.project_members (workspace_id, project_id, profile_id, role) values ($1, $2, $3, 'member')`,
    [h.ws, h.vit, profile.id],
  );
  member = {
    type: "user",
    id: profile.id,
    scope: "internal",
    role: "member",
    workspaceId: h.ws,
    name: "Equipe Dois",
  };
});

afterAll(async () => {
  await h.db.close();
});

describe("marcos pela tela", () => {
  it("cria com o próximo código, no fim da lista e com os critérios", async () => {
    const created = await inTx(asOwner(), (t) =>
      createMilestone(t, "VIT", milestone()),
    );
    // VIT já tem o M1 no ambiente de teste.
    expect(created).toMatchObject({
      code: "M2",
      title: "Painel da recepção",
      status: "planned",
      visibility: "client",
      acceptance_criteria: [
        { text: "Fila do dia na tela", done: true },
        { text: "Aviso de chegada", done: false },
      ],
    });
    expect(created.sort_order).toBeGreaterThan(1);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log where action = 'milestone.created' and entity_id = $1`,
        [created.id],
      ),
    ).toBe(1);
  });

  it("muda a data com histórico e motivo; entregue marca a data de entrega", async () => {
    const m = await inTx(asOwner(), (t) =>
      createMilestone(t, "VIT", milestone({ title: "Relatórios" })),
    );
    const { ...fields } = milestone({ title: "Relatórios" });
    const moved = await inTx(asOwner(), (t) =>
      updateMilestone(t, m.id, {
        ...fields,
        due_date: "2026-12-15",
        status: "delivered",
        date_reason: "A clínica pediu mais duas semanas.",
      }),
    );
    expect(moved.due_date).toBe("2026-12-15");
    expect(moved.status).toBe("delivered");
    expect(moved.delivered_at).not.toBeNull();
    const history = await h.raw.query<{
      old_due: string;
      new_due: string;
      reason_internal: string;
    }>(
      `select old_due::text, new_due::text, reason_internal from ${S}.milestone_date_history where milestone_id = $1`,
      [m.id],
    );
    expect(history.rows).toEqual([
      {
        old_due: "2026-11-30",
        new_due: "2026-12-15",
        reason_internal: "A clínica pediu mais duas semanas.",
      },
    ]);
    // Sem mudança: nada gravado.
    const logs = await count(
      h,
      `select count(*)::int as n from ${S}.activity_log where action = 'milestone.updated' and entity_id = $1`,
      [m.id],
    );
    await inTx(asOwner(), (t) =>
      updateMilestone(t, m.id, {
        ...fields,
        due_date: "2026-12-15",
        status: "delivered",
      }),
    );
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log where action = 'milestone.updated' and entity_id = $1`,
        [m.id],
      ),
    ).toBe(logs);
  });

  it("pedido de aceite vai para as aprovações; aceito, o marco trava", async () => {
    const m = await inTx(asOwner(), (t) =>
      createMilestone(t, "VIT", milestone({ title: "Lançamento" })),
    );
    const approval = await inTx(asOwner(), (t) =>
      requestMilestoneAcceptance(t, m.id),
    );
    expect(approval).toMatchObject({
      type: "milestone_acceptance",
      status: "pending",
      title: `Aceite do ${m.code}: Lançamento`,
    });
    expect(approval.summary).toMatch(/1 de 2/);
    const again = await hubError(
      inTx(asOwner(), (t) => requestMilestoneAcceptance(t, m.id)),
    );
    expect(again.status).toBe(409);

    await inTx(asOwner(), (t) =>
      decideApproval(t, approval.id, { decision: "approved" }),
    );
    const locked = await hubError(
      inTx(asOwner(), (t) =>
        updateMilestone(t, m.id, milestone({ title: "Mudou" })),
      ),
    );
    expect(locked.status).toBe(422);
  });

  it("marco que o cliente vê precisa do título escrito para ele", async () => {
    const err = await hubError(
      inTx(asOwner(), (t) =>
        createMilestone(t, "VIT", milestone({ title_client: null })),
      ),
    );
    expect(err.status).toBe(400);
    const internal = await inTx(asOwner(), (t) =>
      createMilestone(
        t,
        "VIT",
        milestone({ title_client: null, visibility: "internal" }),
      ),
    );
    expect(internal.visibility).toBe("internal");
  });

  it("equipe comum e agentes não criam nem editam marco", async () => {
    expect(
      (
        await hubError(
          inTx(ctxFor(h, member, "ui"), (t) =>
            createMilestone(t, "VIT", milestone()),
          ),
        )
      ).status,
    ).toBe(403);
    const fromAgent = await hubError(
      inTx(ctxFor(h, agent, "mcp"), (t) =>
        createMilestone(t, "VIT", milestone()),
      ),
    );
    expect(fromAgent.status).toBe(403);
    expect(fromAgent.extra).toMatchObject({ human_only: true });
  });
});

describe("frente visível ao cliente", () => {
  it("o dono mostra com título para o cliente e pode voltar a esconder", async () => {
    const shown = await inTx(asOwner(), (t) =>
      setWorkstreamVisibility(t, h.vitWorkstream, {
        visibility: "client",
        title_client: "Atendimento no WhatsApp",
        description_client: "Como o agente conversa com os pacientes.",
      }),
    );
    expect(shown).toMatchObject({
      visibility: "client",
      title_client: "Atendimento no WhatsApp",
    });
    const hidden = await inTx(asOwner(), (t) =>
      setWorkstreamVisibility(t, h.vitWorkstream, {
        visibility: "internal",
        title_client: "Atendimento no WhatsApp",
        description_client: null,
      }),
    );
    expect(hidden.visibility).toBe("internal");
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log where action = 'workstream.visibility_changed'`,
      ),
    ).toBe(2);
  });

  it("sem título para o cliente não mostra; equipe comum e agentes não decidem", async () => {
    expect(
      (
        await hubError(
          inTx(asOwner(), (t) =>
            setWorkstreamVisibility(t, h.vitWorkstream, {
              visibility: "client",
              title_client: null,
              description_client: null,
            }),
          ),
        )
      ).status,
    ).toBe(400);
    const input = {
      visibility: "client" as const,
      title_client: "X",
      description_client: null,
    };
    expect(
      (
        await hubError(
          inTx(ctxFor(h, member, "ui"), (t) =>
            setWorkstreamVisibility(t, h.vitWorkstream, input),
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await hubError(
          inTx(ctxFor(h, agent, "mcp"), (t) =>
            setWorkstreamVisibility(t, h.vitWorkstream, input),
          ),
        )
      ).status,
    ).toBe(403);
  });
});
