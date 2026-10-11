import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { decideApproval, requestApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";

const S = "proj_hub_gestao";
let h: TestHub;
let pausedKey: string;

beforeAll(async () => {
  h = await openTestHub();
  pausedKey = (
    await h.raw.query<{ id: string }>(
      `select id from ${S}.agent_api_keys where agent_id = $1`,
      [h.agents.pausado],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await h.db.close();
});

const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asAuditor = async () =>
  ctxFor(
    h,
    { ...(await agentActor(h, h.keys.todos)), actingRole: "AC-14" },
    "mcp",
  );

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

const ask = async (payload: Record<string, unknown>, project?: string) =>
  inTx(await asAuditor(), (t) =>
    requestApproval(t, {
      type: "agent_key",
      title: "Revogar a chave parada",
      summary: "Chave sem uso há 90 dias.",
      payload,
      ...(project ? { project } : {}),
    }),
  );

describe("pedido de revogar chave de agente (agent_key, RF-25)", () => {
  it("o auditor pede; o Hub completa a chave e o agente; o pedido não é de projeto", async () => {
    const asked = await ask({ key_id: pausedKey });
    expect(asked).toMatchObject({
      type: "agent_key",
      status: "pending",
      project_code: null,
      payload: {
        key_id: pausedKey,
        action: "revoke",
        agent_name: "Pausado",
        key_prefix: expect.any(String),
      },
    });
    // Repetido para a mesma chave: conflito.
    expect(await status(ask({ key_id: pausedKey }))).toBe(409);

    // Aprovar revoga a chave na hora; a chave não entra mais.
    const decided = await inTx(asOwner(), (t) =>
      decideApproval(t, asked.id, { decision: "approved" }),
    );
    expect(decided.effect).toMatchObject({
      applied: true,
      key_revoked: asked.payload.key_prefix,
    });
    const key = await h.raw.query<{ revoked: boolean }>(
      `select revoked_at is not null as revoked from ${S}.agent_api_keys where id = $1`,
      [pausedKey],
    );
    expect(key.rows[0].revoked).toBe(true);
    expect(await status(agentActor(h, h.keys.pausado))).toBe(401);
    // Chave já revogada: não há o que pedir.
    expect(await status(ask({ key_id: pausedKey }))).toBe(409);
  });

  it("formato e permissão: sem key_id, com projeto ou sem auditoria é recusado", async () => {
    expect(await status(ask({}))).toBe(400);
    expect(await status(ask({ key_id: pausedKey }, "VIT"))).toBe(400);
    expect(
      await status(ask({ key_id: "00000000-0000-4000-8000-000000000000" })),
    ).toBe(422);
    const kratos = await agentActor(h, h.keys.kratos);
    expect(
      await status(
        inTx(ctxFor(h, kratos, "mcp"), (t) =>
          requestApproval(t, {
            type: "agent_key",
            title: "Revogar",
            payload: { key_id: pausedKey },
          }),
        ),
      ),
    ).toBe(403);
    // Os outros pedidos continuam exigindo o projeto.
    expect(
      await status(
        inTx(ctxFor(h, kratos, "mcp"), (t) =>
          requestApproval(t, { type: "custom", title: "Sem projeto" }),
        ),
      ),
    ).toBe(400);
  });

  it("chave revogada na Sala de Controle depois do pedido: aprovar não muda nada", async () => {
    const leitor = (
      await h.raw.query<{ id: string }>(
        `select k.id from ${S}.agent_api_keys k
          where k.agent_id = $1 and k.revoked_at is null
          order by k.created_at limit 1`,
        [h.agents.executor],
      )
    ).rows[0].id;
    const asked = await ask({ key_id: leitor });
    await h.raw.query(
      `update ${S}.agent_api_keys set revoked_at = now() where id = $1`,
      [leitor],
    );
    const decided = await inTx(asOwner(), (t) =>
      decideApproval(t, asked.id, { decision: "approved" }),
    );
    expect(decided.effect).toMatchObject({ applied: false });
  });
});
