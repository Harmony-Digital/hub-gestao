import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inTx } from "@/modules/context";
import { createTask, updateTask } from "@/modules/tasks/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { logTime, projectTime, taskTime } from "./service";

let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const tasks: Record<string, { id: string; code: string }> = {};

beforeAll(async () => {
  h = await openTestHub();
  const old = (
    await h.raw.query<{ day: string }>(
      `select (date_trunc('month', current_date) - interval '10 days')::date::text as day`,
    )
  ).rows[0].day;
  await inTx(asOwner(), async (t) => {
    tasks.a = await createTask(t, {
      project: "VIT",
      title: "Fluxo de agendamento",
      workstream_id: h.vitWorkstream,
      estimate_minutes: 60,
    });
    tasks.b = await createTask(t, {
      project: "VIT",
      title: "Mensagens padrão",
      workstream_id: h.vitWorkstream,
    });
    await updateTask(t, tasks.b.code, { estimate_minutes: 120 });
    tasks.c = await createTask(t, { project: "VIT", title: "Sem estimativa" });
    await logTime(t, tasks.a.code, { minutes: 90, note: "Primeira versão" });
    await logTime(t, tasks.b.code, { minutes: 60 });
    await logTime(t, tasks.c.code, { minutes: 45, entry_date: old });
  });
  const kratos = await agentActor(h, h.keys.kratos);
  await inTx(ctxFor(h, kratos), (t) =>
    logTime(t, tasks.a.code, { minutes: 30 }),
  );
});

afterAll(async () => {
  await h.db.close();
});

describe("tempo do projeto (TO-15)", () => {
  it("soma por pessoa ou agente e por frente, com o mês separado", async () => {
    const time = await inTx(asOwner(), (t) => projectTime(t, "VIT"));
    expect(time).toMatchObject({
      project_code: "VIT",
      total_minutes: 225,
      month_minutes: 180,
    });
    expect(
      time.by_actor.map((a) => [a.actor.name, a.minutes, a.month_minutes]),
    ).toEqual([
      ["Fábio Almeida", 195, 150],
      ["Kratos", 30, 30],
    ]);
    expect(time.by_workstream).toEqual([
      { workstream: "Fluxo de atendimento", minutes: 180 },
      { workstream: null, minutes: 45 },
    ]);
  });

  it("compara com a estimativa e aponta as tarefas acima dela", async () => {
    const time = await inTx(asOwner(), (t) => projectTime(t, "VIT"));
    expect(time.estimate).toEqual({
      tasks: 2,
      estimated_minutes: 180,
      actual_minutes: 180,
    });
    expect(time.overruns).toEqual([
      {
        code: tasks.a.code,
        title: "Fluxo de agendamento",
        estimate_minutes: 60,
        actual_minutes: 120,
      },
    ]);
  });

  it("o painel da tarefa traz as entradas e o total", async () => {
    const time = await inTx(asOwner(), (t) => taskTime(t, tasks.a.id));
    expect(time.totalMinutes).toBe(120);
    expect(time.entries.map((e) => [e.actor.name, e.minutes, e.note])).toEqual(
      expect.arrayContaining([
        ["Fábio Almeida", 90, "Primeira versão"],
        ["Kratos", 30, null],
      ]),
    );
  });

  it("soma o custo de IA ligado ao projeto, por agente, com o mês separado", async () => {
    await h.raw.query(
      `insert into proj_hub_gestao.agent_runs
         (workspace_id, agent_id, started_at, finished_at, source, summary, cost_usd, project_id)
       values ($1, $2, now(), now(), 'llm', 'Planejador', 0.25, $3),
              ($1, $2, now() - interval '70 days', now() - interval '70 days', 'llm', 'Planejador', 0.10, $3),
              ($1, $2, now(), now(), 'llm', 'Concierge', 0.50, null)`,
      [h.ws, h.agents.kratos, h.vit],
    );
    const time = await inTx(asOwner(), (t) => projectTime(t, "VIT"));
    expect(time.ai_cost_usd).toEqual({
      month: 0.25,
      total: 0.35,
      by_agent: [{ agent: "Kratos", month: 0.25, total: 0.35 }],
    });
  });

  it("agente lê o tempo do projeto pela chave com tasks:read", async () => {
    const kratos = await agentActor(h, h.keys.kratos);
    const time = await inTx(ctxFor(h, kratos), (t) => projectTime(t, "VIT"));
    expect(time.total_minutes).toBe(225);
  });
});
