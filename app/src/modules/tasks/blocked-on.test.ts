import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { inbox } from "@/modules/notifications";
import { today } from "@/modules/today/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { blockTask, createTask, getTask, startTask } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
let bia: UserActor;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

beforeAll(async () => {
  h = await openTestHub();
  // Pessoa da equipe que participa do VIT e vai destravar a tarefa.
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('bia@exemplo.com', 'Bia') returning id`,
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
  bia = {
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

describe("quem destrava a tarefa bloqueada", () => {
  it("o agente bloqueia dizendo quem destrava; a pessoa recebe o aviso e vê no Hoje", async () => {
    const kratos = await agentActor(h, h.keys.kratos);
    const task = await inTx(ctxFor(h, kratos, "mcp"), (t) =>
      createTask(t, { project: "VIT", title: "Integrar a agenda" }),
    );
    const blocked = await inTx(ctxFor(h, kratos, "mcp"), (t) =>
      blockTask(t, task.code, {
        reason: "Falta a credencial da agenda.",
        waiting_on: { type: "user", id: bia.id! },
      }),
    );
    expect(blocked.blocked_on).toEqual({
      type: "user",
      id: bia.id,
      name: "Bia",
    });

    const box = await inTx(ctxFor(h, bia, "ui"), (t) => inbox(t));
    expect(box.items[0]).toMatchObject({
      type: "task.blocked",
      text: `${task.code} está esperando você em VIT`,
      detail: "Falta a credencial da agenda.",
    });

    const mine = await inTx(ctxFor(h, bia, "ui"), (t) => today(t));
    expect(mine.waiting_on_me.map((x) => x.code)).toEqual([task.code]);
    expect(mine.counts.waiting_on_me).toBe(1);
    expect(mine.blocked.find((x) => x.code === task.code)?.blocked_on).toEqual({
      type: "user",
      id: bia.id,
      name: "Bia",
    });
    // O dono não é quem destrava: para ele, é um bloqueio comum.
    const owner = await inTx(asOwner(), (t) => today(t));
    expect(owner.waiting_on_me).toEqual([]);

    // Saiu do bloqueio: o campo é limpo.
    await inTx(asOwner(), (t) => startTask(t, task.code));
    const started = await inTx(asOwner(), (t) => getTask(t, task.code));
    expect(started.blocked_on).toBeNull();
    expect(started.blocked_reason).toBeNull();
  });

  it("recusa quem não é do workspace; sem indicação, fica sem ninguém", async () => {
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Revisar o texto" }),
    );
    const err = await inTx(asOwner(), (t) =>
      blockTask(t, task.code, {
        reason: "Aguarda alguém de fora.",
        waiting_on: {
          type: "user",
          id: "00000000-0000-4000-8000-000000000000",
        },
      }),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HubError);
    expect((err as HubError).status).toBe(422);

    const plain = await inTx(asOwner(), (t) =>
      blockTask(t, task.code, { reason: "Aguarda o cliente." }),
    );
    expect(plain.blocked_on).toBeNull();
  });
});
