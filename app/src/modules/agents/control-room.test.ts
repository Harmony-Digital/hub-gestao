import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { createTask } from "@/modules/tasks/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import {
  controlRoom,
  controlRoomMarker,
  readControlRoomFilter,
} from "./control-room";
import { claimDenial, recordDenial } from "./denials";

const S = "proj_hub_gestao";
let h: TestHub;
let member: UserActor;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const NONE = { agent: null, project: null };

beforeAll(async () => {
  h = await openTestHub();
  // Pessoa da equipe que não participa do VIT.
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('bia@exemplo.com', 'Bia') returning id`,
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
    name: "Bia",
  };
});

afterAll(async () => {
  await h.db.close();
});

describe("Sala de Controle", () => {
  it("mostra o que os agentes fizeram, com filtro por agente e projeto", async () => {
    const before = await inTx(asOwner(), (t) => controlRoomMarker(t));
    const kratos = await agentActor(h, h.keys.kratos);
    const task = await inTx(ctxFor(h, kratos, "mcp"), (t) =>
      createTask(t, { project: "VIT", title: "Revisar o roteiro" }),
    );
    expect(await inTx(asOwner(), (t) => controlRoomMarker(t))).not.toBe(before);

    const room = await inTx(asOwner(), (t) => controlRoom(t, NONE));
    expect(room.feed[0]).toMatchObject({
      agent: "Kratos",
      source: "mcp",
      text: `criou ${task.code}`,
      projectCode: "VIT",
      taskCode: task.code,
    });
    expect(room.kpis).toMatchObject({ active: 2, paused: 1, budgetMonth: 10 });
    expect(room.kpis.actions24h).toBeGreaterThan(0);
    expect(room.filters.agents.map((a) => a.name)).toContain("Kratos");
    expect(room.filters.projects.map((p) => p.code)).toContain("VIT");

    const byOther = await inTx(asOwner(), (t) =>
      controlRoom(t, { agent: h.agents.executor, project: null }),
    );
    expect(byOther.feed).toEqual([]);
    const byHub = await inTx(asOwner(), (t) =>
      controlRoom(t, { agent: null, project: "HUB" }),
    );
    expect(byHub.feed.some((e) => e.taskCode === task.code)).toBe(false);

    // Quem é da equipe e não participa do VIT não vê a atividade de lá.
    const asMember = await inTx(ctxFor(h, member, "ui"), (t) =>
      controlRoom(t, NONE),
    );
    expect(asMember.feed.some((e) => e.projectCode === "VIT")).toBe(false);
  });

  it("registra a recusa de um agente uma vez por minuto e mostra na sala", async () => {
    const reader = await agentActor(h, h.keys.leitor);
    const denied = await inTx(ctxFor(h, reader, "mcp"), (t) =>
      createTask(t, { project: "VIT", title: "Sem permissão" }),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(denied).toBeInstanceOf(HubError);
    expect((denied as HubError).status).toBe(403);

    const before = await inTx(asOwner(), (t) => controlRoomMarker(t));
    const who = {
      workspaceId: reader.workspaceId,
      agentId: reader.id,
      keyPrefix: "hub_ak_teste",
    };
    await recordDenial(h.db, who, "mcp", "hub_create_task", denied);
    // Repetida no mesmo minuto: não grava de novo.
    await recordDenial(h.db, who, "mcp", "hub_create_task", denied);
    // Erro que não é recusa de acesso: não grava.
    await recordDenial(
      h.db,
      who,
      "api",
      "POST /api/v1/tasks",
      new HubError(422, "unprocessable", "Regra", "Regra de dados."),
    );
    // Agente de outro workspace (inexistente): a função ignora.
    await recordDenial(
      h.db,
      { ...who, agentId: "00000000-0000-4000-8000-000000000000" },
      "api",
      "GET /api/v1/me",
      denied,
    );

    const room = await inTx(asOwner(), (t) => controlRoom(t, NONE));
    expect(room.denials).toHaveLength(1);
    expect(room.denials[0]).toMatchObject({
      agent: "Executor",
      source: "mcp",
      status: 403,
      action: "hub_create_task",
    });
    expect(room.denials[0].reason.length).toBeGreaterThan(5);
    expect(room.kpis.denials24h).toBe(1);
    expect(await inTx(asOwner(), (t) => controlRoomMarker(t))).not.toBe(before);
  });

  it("limita o registro a uma vez por minuto por agente, recusa e ação", () => {
    const now = 1_000_000;
    expect(claimDenial("a|403|x", now)).toBe(true);
    expect(claimDenial("a|403|x", now + 59_000)).toBe(false);
    expect(claimDenial("a|403|y", now + 1_000)).toBe(true);
    expect(claimDenial("a|403|x", now + 61_000)).toBe(true);
  });

  it("lê o filtro do endereço e ignora valor fora do formato", () => {
    expect(
      readControlRoomFilter({
        agente: "0b7c6f1e-6f6a-4f0e-9a51-2f7d4c1b8a90",
        projeto: "VIT",
      }),
    ).toEqual({
      agent: "0b7c6f1e-6f6a-4f0e-9a51-2f7d4c1b8a90",
      project: "VIT",
    });
    expect(readControlRoomFilter({ agente: "x", projeto: "vit" })).toEqual(
      NONE,
    );
  });
});
