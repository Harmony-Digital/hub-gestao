import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { inTx } from "@/modules/context";
import { search } from "@/modules/search/service";
import { createTask } from "@/modules/tasks/service";
import { responsibleOf, tasksOf } from "@/modules/tasks/mine";
import { addMember, setMemberStatus } from "@/modules/workspace/settings";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";

const S = "proj_hub_gestao";
let h: TestHub;

beforeAll(async () => {
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});

const asOwner = () => ctxFor(h, h.owner_actor, "ui");

describe("busca ⌘K: pessoas e agentes (RF-38)", () => {
  it("o dono acha agentes (ativos e pausados) e pessoas pelo nome, sem o e-mail", async () => {
    const found = await inTx(asOwner(), (t) => search(t, "krat"));
    expect(found.agents).toEqual([
      {
        id: h.agents.kratos,
        name: "Kratos",
        status: "active",
        department: null,
      },
    ]);
    const paused = await inTx(asOwner(), (t) => search(t, "pausa"));
    expect(paused.agents.map((a) => a.status)).toEqual(["paused"]);

    await inTx(asOwner(), (t) =>
      addMember(t, {
        name: "Bruna Busca",
        email: "bruna.busca@harmony.test",
        role: "member",
      }),
    );
    const people = await inTx(asOwner(), (t) => search(t, "bruna"));
    expect(people.people).toHaveLength(1);
    expect(people.people[0]).toEqual({
      id: expect.any(String),
      name: "Bruna Busca",
      role: "member",
    });
    // Nome, não e-mail: o e-mail não acha ninguém.
    expect(
      (await inTx(asOwner(), (t) => search(t, "harmony.test"))).people,
    ).toEqual([]);
  });

  it("pessoa suspensa e agente revogado não aparecem", async () => {
    const added = await inTx(asOwner(), (t) =>
      addMember(t, {
        name: "Sérgio Suspenso",
        email: "sergio.suspenso@harmony.test",
        role: "member",
      }),
    );
    await inTx(asOwner(), (t) =>
      setMemberStatus(t, added.profileId, "suspended"),
    );
    expect(
      (await inTx(asOwner(), (t) => search(t, "suspenso"))).people,
    ).toEqual([]);
    await h.raw.query(
      `update ${S}.agents set status = 'revoked' where name = 'Pausado'`,
    );
    expect((await inTx(asOwner(), (t) => search(t, "pausa"))).agents).toEqual(
      [],
    );
  });

  it("o agente também acha pessoas e agentes, para atribuir tarefas (só nome e papel)", async () => {
    const kratos = await agentActor(h, h.keys.kratos);
    const found = await inTx(ctxFor(h, kratos, "mcp"), (t) =>
      search(t, "krat"),
    );
    expect(found.agents.map((a) => a.id)).toEqual([h.agents.kratos]);
    const owner = await inTx(ctxFor(h, kratos, "mcp"), (t) =>
      search(t, "Fábio"),
    );
    expect(owner.people).toEqual([
      { id: h.owner, name: expect.any(String), role: "owner" },
    ]);
  });
});

describe("busca sem diferenciar acento", () => {
  it("“fabio” acha “Fábio” e “reuniao” acha “Reunião”, com o código exato ainda valendo", async () => {
    const found = await inTx(asOwner(), (t) => search(t, "fabio"));
    expect(found.people.map((p) => p.id)).toContain(h.owner);
    const task = await inTx(asOwner(), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Reunião de alinhamento com a clínica",
      }),
    );
    const byTitle = await inTx(asOwner(), (t) => search(t, "REUNIAO de"));
    expect(byTitle.tasks.map((x) => x.code)).toContain(task.code);
    const byCode = await inTx(asOwner(), (t) =>
      search(t, task.code.toLowerCase()),
    );
    expect(byCode.tasks[0].code).toBe(task.code);
    // Curinga do LIKE digitado vale como texto.
    expect((await inTx(asOwner(), (t) => search(t, "%%"))).tasks).toEqual([]);
  });
});

describe("tarefas de um responsável", () => {
  it("lista o que está com o agente, só nos projetos de quem vê", async () => {
    const task = await inTx(asOwner(), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Tarefa do Kratos para a busca",
        assignee: { type: "agent", id: h.agents.kratos },
      }),
    );
    const data = await inTx(asOwner(), (t) =>
      tasksOf(t, { type: "agent", id: h.agents.kratos }),
    );
    expect(data.open.map((x) => x.code)).toContain(task.code);
    expect(data.projects.map((p) => p.code)).toEqual(["VIT"]);
    // Quem não enxerga o VIT não vê a tarefa: o alcance é o de quem vê (aqui, uma pessoa
    // da equipe sem projeto).
    const added = await inTx(asOwner(), (t) =>
      addMember(t, {
        name: "Nina Sem Projeto",
        email: "nina.sem.projeto@harmony.test",
        role: "member",
      }),
    );
    const nina: UserActor = {
      type: "user",
      id: added.profileId,
      scope: "internal",
      role: "member",
      workspaceId: h.ws,
      name: "Nina Sem Projeto",
    };
    const none = await inTx(ctxFor(h, nina, "ui"), (t) =>
      tasksOf(t, { type: "agent", id: h.agents.kratos }),
    );
    expect(none.open).toEqual([]);
  });

  it("diz quem é o responsável: pessoa com o papel, agente com a situação", async () => {
    expect(
      await inTx(asOwner(), (t) => responsibleOf(t, h.owner)),
    ).toMatchObject({ type: "user", id: h.owner, role: "owner" });
    expect(
      await inTx(asOwner(), (t) => responsibleOf(t, h.agents.kratos)),
    ).toMatchObject({
      type: "agent",
      name: "Kratos",
      role: "active",
      department: null,
    });
    expect(
      await inTx(asOwner(), (t) =>
        responsibleOf(t, "00000000-0000-4000-8000-000000000000"),
      ),
    ).toBeNull();
  });
});
