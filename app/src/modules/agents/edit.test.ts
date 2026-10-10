import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { listAgentsConsole, setAgentStatus, updateAgent } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
let outsider: string;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asRole = (role: UserActor["role"]) =>
  ctxFor(h, { ...h.owner_actor, role }, "ui");

async function hubError(promise: Promise<unknown>): Promise<HubError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HubError);
  return err as HubError;
}

async function history(agentId: string) {
  return (
    await h.raw.query<{ action: string; before: unknown; after: unknown }>(
      `select action, before, after from ${S}.activity_log
        where entity_type = 'agent' and entity_id = $1 order by id`,
      [agentId],
    )
  ).rows;
}

beforeAll(async () => {
  h = await openTestHub();
  // Pessoa sem vínculo com o workspace: não pode ser responsável por agente.
  outsider = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('fora@exemplo.com', 'De Fora') returning id`,
    )
  ).rows[0].id;
});

afterAll(async () => {
  await h.db.close();
});

describe("cadastro completo do agente", () => {
  it("grava só o que mudou, com o antes e o depois no histórico", async () => {
    const changed = await inTx(asOwner(), (t) =>
      updateAgent(t, h.agents.kratos, {
        department: "gestao",
        mission: "  Gerir os projetos da Harmony e cobrar os prazos.  ",
        budget_usd_month: 20,
        owner: h.owner,
      }),
    );
    expect(changed).toEqual(["department", "mission", "budget_usd_month"]);

    const data = await inTx(asOwner(), (t) => listAgentsConsole(t));
    const kratos = data.agents.find((a) => a.id === h.agents.kratos)!;
    expect(kratos).toMatchObject({
      department: { slug: "gestao" },
      mission: "Gerir os projetos da Harmony e cobrar os prazos.",
      budgetUsdMonth: 20,
      spentUsdMonth: 0,
      owner: { id: h.owner },
    });
    expect(data.departments.map((d) => d.slug)).toContain("gestao");
    expect(data.people.map((p) => p.id)).toContain(h.owner);

    // Salvar de novo sem mudança não grava nada.
    expect(
      await inTx(asOwner(), (t) =>
        updateAgent(t, h.agents.kratos, {
          department: "gestao",
          budget_usd_month: 20,
        }),
      ),
    ).toEqual([]);
    const log = await history(h.agents.kratos);
    expect(log.map((e) => e.action)).toEqual([
      "agent.created",
      "agent.updated",
    ]);
    expect(log[1].after).toMatchObject({
      department: "gestao",
      budget_usd_month: 20,
    });

    // Limpar o departamento e a missão.
    expect(
      await inTx(asOwner(), (t) =>
        updateAgent(t, h.agents.kratos, { department: null, mission: null }),
      ),
    ).toEqual(["department", "mission"]);
  });

  it("recusa departamento, responsável e nome inválidos", async () => {
    const update = (input: Parameters<typeof updateAgent>[2]) =>
      hubError(
        inTx(asOwner(), (t) => updateAgent(t, h.agents.executor, input)),
      );
    expect((await update({ department: "nao-existe" })).status).toBe(422);
    expect((await update({ owner: outsider })).status).toBe(422);
    expect((await update({ name: "Kratos" })).status).toBe(409);
    expect(
      (
        await hubError(
          inTx(asOwner(), (t) =>
            updateAgent(t, "00000000-0000-4000-8000-000000000000", {
              mission: "x",
            }),
          ),
        )
      ).status,
    ).toBe(404);
  });

  it("só dono e administração editam, pausam e reativam", async () => {
    expect(
      (
        await hubError(
          inTx(asRole("member"), (t) =>
            updateAgent(t, h.agents.executor, { mission: "Outra" }),
          ),
        )
      ).status,
    ).toBe(403);
    const kratos = await agentActor(h, h.keys.kratos);
    expect(
      (
        await hubError(
          inTx(ctxFor(h, kratos, "mcp"), (t) =>
            setAgentStatus(t, h.agents.executor, "paused"),
          ),
        )
      ).status,
    ).toBe(403);

    await inTx(asRole("admin"), (t) =>
      updateAgent(t, h.agents.executor, { name: "Executor de tarefas" }),
    );
    await inTx(asRole("admin"), (t) =>
      setAgentStatus(t, h.agents.executor, "paused"),
    );
    // Pausar de novo não grava outro registro.
    await inTx(asRole("admin"), (t) =>
      setAgentStatus(t, h.agents.executor, "paused"),
    );
    await inTx(asOwner(), (t) =>
      setAgentStatus(t, h.agents.executor, "active"),
    );
    const log = await history(h.agents.executor);
    expect(log.map((e) => e.action)).toEqual([
      "agent.created",
      "agent.updated",
      "agent.status_changed",
      "agent.status_changed",
    ]);
    expect(log[2]).toMatchObject({
      before: { status: "active" },
      after: { status: "paused" },
    });
  });

  it("agente revogado não é editado nem reativado pela tela", async () => {
    await inTx(asOwner(), (t) =>
      setAgentStatus(t, h.agents.pausado, "revoked"),
    );
    expect(
      (
        await hubError(
          inTx(asOwner(), (t) =>
            updateAgent(t, h.agents.pausado, { mission: "Voltar" }),
          ),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await hubError(
          inTx(asOwner(), (t) => setAgentStatus(t, h.agents.pausado, "active")),
        )
      ).status,
    ).toBe(422);
  });
});
