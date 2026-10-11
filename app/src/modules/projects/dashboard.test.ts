import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import {
  blockTask,
  completeTask,
  createTask,
  startTask,
} from "@/modules/tasks/service";
import { updateWorkstream } from "@/modules/workstreams/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { projectDashboard } from "./dashboard";

let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const codes: Record<string, string> = {};

beforeAll(async () => {
  h = await openTestHub();
  const days = (
    await h.raw.query<{ yesterday: string; soon: string }>(
      `select (current_date - 1)::text as yesterday, (current_date + 3)::text as soon`,
    )
  ).rows[0];
  await inTx(asOwner(), (t) =>
    updateWorkstream(t, h.vitWorkstream, { department: "sistemas" }),
  );
  const kratos = await agentActor(h, h.keys.kratos);
  await inTx(ctxFor(h, kratos), async (t) => {
    const late = await createTask(t, {
      project: "VIT",
      title: "Atrasada",
      workstream_id: h.vitWorkstream,
      due_date: days.yesterday,
      assignee: { type: "user", id: h.owner },
    });
    const going = await createTask(t, {
      project: "VIT",
      title: "Em andamento",
      workstream_id: h.vitWorkstream,
    });
    await startTask(t, going.code);
    const stuck = await createTask(t, {
      project: "VIT",
      title: "Bloqueada",
      workstream_id: h.vitWorkstream,
    });
    await blockTask(t, stuck.code, { reason: "Falta o acesso da clínica." });
    const done = await createTask(t, {
      project: "VIT",
      title: "Feita",
      workstream_id: h.vitWorkstream,
    });
    const soon = await createTask(t, {
      project: "VIT",
      title: "Vence logo",
      due_date: days.soon,
    });
    Object.assign(codes, {
      late: late.code,
      going: going.code,
      stuck: stuck.code,
      done: done.code,
      soon: soon.code,
    });
  });
  // O agente fica com uma tarefa em andamento por vez: a conclusão é do dono.
  await inTx(asOwner(), (t) =>
    completeTask(t, codes.done, { evidence: "https://exemplo.com/ok" }),
  );
});

afterAll(async () => {
  await h.db.close();
});

describe("painel do projeto", () => {
  it("conta as tarefas, a carga e o que os agentes fizeram", async () => {
    const d = await inTx(asOwner(), (t) => projectDashboard(t, "VIT"));
    expect(d.tasks).toMatchObject({
      open: 4,
      inProgress: 1,
      blocked: 1,
      done: 1,
      doneWeek: 1,
      late: 1,
      dueWeek: 1,
    });
    // A que vence logo não tem frente: entra em "Sem departamento".
    expect(d.departments.map((x) => [x.name, x.open, x.doneWeek])).toEqual([
      ["Sistemas", 3, 1],
      ["Sem departamento", 1, 0],
    ]);
    const owner = d.assignees.find((a) => a.who.id === h.owner);
    expect(owner).toMatchObject({ open: 1, late: 1 });
    expect(d.milestones.map((m) => m.code)).toEqual(["M1"]);
    expect(d.health.inputs.blocked_task_count).toBe(1);
    expect(d.agents.byAgent[0]).toMatchObject({ name: "Kratos" });
    expect(d.agents.actionsWeek).toBeGreaterThanOrEqual(5);
    expect(d.agents.recent.length).toBeGreaterThan(0);
    expect(d.agents.recent.map((r) => r.text)).toContain(
      `bloqueou ${codes.stuck}`,
    );
    expect(d.dependencyAlerts).toEqual([]);
  });

  it("projeto que não existe dá 404", async () => {
    await expect(
      inTx(asOwner(), (t) => projectDashboard(t, "NAOEX")),
    ).rejects.toSatisfy((e) => e instanceof HubError && e.status === 404);
  });
});
