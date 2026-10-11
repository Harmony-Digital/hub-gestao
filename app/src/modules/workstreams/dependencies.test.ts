import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import {
  archiveWorkstream,
  restoreWorkstream,
} from "@/modules/archive/service";
import { inTx } from "@/modules/context";
import { getProjectHealth } from "@/modules/projects/service";
import { projectTaskList } from "@/modules/tasks/board";
import { addDependency } from "@/modules/tasks/extras";
import { completeTask, createTask, startTask } from "@/modules/tasks/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";
import { dependencyAlertsOf } from "./dependencies";
import { createWorkstream, updateWorkstream } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
/** Frentes do VIT: A (o fluxo do cenário), B, C e D. */
const ws = { a: "", b: "", c: "", d: "", hub: "" };

beforeAll(async () => {
  h = await openTestHub();
  ws.a = h.vitWorkstream;
  await inTx(asOwner(), async (t) => {
    ws.b = (await createWorkstream(t, { project: "VIT", title: "Telas" })).id;
    ws.c = (await createWorkstream(t, { project: "VIT", title: "Testes" })).id;
    ws.d = (
      await createWorkstream(t, { project: "VIT", title: "Lançamento" })
    ).id;
    ws.hub = (await createWorkstream(t, { project: "HUB", title: "Outra" })).id;
  });
});

afterAll(async () => {
  await h.db.close();
});

const set = (id: string, dependsOn: string[]) =>
  inTx(asOwner(), (t) => updateWorkstream(t, id, { depends_on: dependsOn }));

async function refusal(run: Promise<unknown>) {
  try {
    await run;
  } catch (err) {
    if (err instanceof HubError)
      return { status: err.status, message: err.message };
    throw err;
  }
  throw new Error("Era para recusar.");
}

describe("dependências entre frentes", () => {
  it("grava a lista inteira, registra só quando muda e devolve no DTO", async () => {
    const changes = () =>
      count(
        h,
        `select count(*)::int as n from ${S}.activity_log
          where action = 'workstream.dependencies_changed' and entity_id = $1`,
        [ws.b],
      );
    const first = await set(ws.b, [ws.a, ws.a]);
    expect(first.depends_on).toEqual([ws.a]);
    expect(await changes()).toBe(1);
    const log = await h.raw.query<{ before: unknown; after: unknown }>(
      `select before, after from ${S}.activity_log
        where action = 'workstream.dependencies_changed' and entity_id = $1`,
      [ws.b],
    );
    expect(log.rows[0]).toEqual({
      before: { depends_on: [] },
      after: { depends_on: ["Fluxo de atendimento"] },
    });
    // A mesma lista de novo não grava nada.
    await set(ws.b, [ws.a]);
    expect(await changes()).toBe(1);
    expect((await set(ws.b, [])).depends_on).toEqual([]);
    expect(await changes()).toBe(2);
  });

  it("recusa a própria frente, frente de outro projeto e ciclo", async () => {
    expect(await refusal(set(ws.b, [ws.b]))).toMatchObject({ status: 400 });
    expect(await refusal(set(ws.b, [ws.hub]))).toEqual({
      status: 422,
      message: "A frente só pode depender de frentes ativas do mesmo projeto.",
    });
    await set(ws.b, [ws.a]);
    // Direto: A depender de B, que depende de A.
    expect(await refusal(set(ws.a, [ws.b]))).toEqual({
      status: 422,
      message:
        "“Telas” já depende desta frente (direta ou indiretamente): a ligação fecharia um ciclo.",
    });
    // Indireto: C depende de B, que depende de A; A depender de C fecharia o laço.
    await set(ws.c, [ws.b]);
    expect(await refusal(set(ws.a, [ws.c]))).toMatchObject({ status: 422 });
    await set(ws.c, []);
    await set(ws.b, []);
  });

  it("agente com a chave cria a frente já com as dependências", async () => {
    const kratos = await agentActor(h, h.keys.kratos);
    const created = await inTx(ctxFor(h, kratos), (t) =>
      createWorkstream(t, {
        project: "VIT",
        title: "Treinamento",
        depends_on: [ws.a],
      }),
    );
    expect(created.depends_on).toEqual([ws.a]);
    await inTx(asOwner(), (t) => archiveWorkstream(t, created.id));
  });

  it("ligação com frente arquivada fica guardada e volta com a restauração", async () => {
    await set(ws.d, [ws.c]);
    await inTx(asOwner(), (t) => archiveWorkstream(t, ws.c));
    const edges = () =>
      count(
        h,
        `select count(*)::int as n from ${S}.workstream_dependencies where workstream_id = $1`,
        [ws.d],
      );
    // A arquivada sai da lista; trocar a lista não apaga a ligação com ela.
    expect((await set(ws.d, [ws.a])).depends_on).toEqual([ws.a]);
    expect(await edges()).toBe(2);
    await inTx(asOwner(), (t) => restoreWorkstream(t, ws.c));
    const back = await inTx(asOwner(), (t) =>
      updateWorkstream(t, ws.d, { title: "Lançamento" }),
    );
    expect(back.depends_on.sort()).toEqual([ws.a, ws.c].sort());
    await set(ws.d, []);
  });

  it("alerta e saúde: a frente começou antes de terminar a de que depende", async () => {
    await set(ws.b, [ws.a]);
    const alerts = () => inTx(asOwner(), (t) => dependencyAlertsOf(t, h.vit));
    // B ainda planejada e sem tarefa começada: está esperando, como deve.
    expect(await alerts()).toEqual([]);
    const task = await inTx(asOwner(), async (t) => {
      const created = await createTask(t, {
        project: "VIT",
        title: "Primeira tela",
        workstream_id: ws.b,
      });
      return startTask(t, created.code);
    });
    expect(await alerts()).toEqual([
      {
        id: ws.b,
        title: "Telas",
        waitingOn: [{ id: ws.a, title: "Fluxo de atendimento" }],
      },
    ]);
    const health = await inTx(asOwner(), (t) => getProjectHealth(t, "VIT"));
    expect(health.health).toBe("at_risk");
    expect(health.inputs.broken_dependencies).toBe(1);
    expect(health.reasons).toContain(
      "1 frente começou antes de terminar a frente de que depende.",
    );
    // A concluída: o alerta some.
    await inTx(asOwner(), (t) => updateWorkstream(t, ws.a, { status: "done" }));
    expect(await alerts()).toEqual([]);
    await inTx(asOwner(), async (t) => {
      await updateWorkstream(t, ws.a, { status: "in_progress" });
      await completeTask(t, task.code, { evidence: "https://exemplo.com/ok" });
      await updateWorkstream(t, ws.b, { depends_on: [] });
    });
  });
});

describe("dependências entre tarefas no quadro", () => {
  it("a tarefa aberta mostra as que ela espera, até elas terminarem", async () => {
    const { first, second } = await inTx(asOwner(), async (t) => {
      const first = await createTask(t, { project: "VIT", title: "Base" });
      const second = await createTask(t, { project: "VIT", title: "Topo" });
      await addDependency(t, second.code, first.code);
      return { first, second };
    });
    const list = () => inTx(asOwner(), (t) => projectTaskList(t, "VIT"));
    expect((await list()).waitingOn[second.code]).toEqual([first.code]);
    await inTx(asOwner(), (t) =>
      completeTask(t, first.code, { evidence: "https://exemplo.com/ok" }),
    );
    expect((await list()).waitingOn[second.code]).toBeUndefined();
  });
});
