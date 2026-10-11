import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inTx } from "@/modules/context";
import { systemActor } from "@/modules/jobs/service";
import { getProjectHealth } from "@/modules/projects/service";
import { completeTask, createTask } from "@/modules/tasks/service";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { forecastInputsOf } from "./forecast";
import { refreshAllHealth } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const codes: string[] = [];

beforeAll(async () => {
  h = await openTestHub();
  for (const title of ["Roteiro", "Integração", "Testes"]) {
    const task = await inTx(asOwner(), (t) =>
      createTask(t, {
        project: "VIT",
        title,
        workstream_id: h.vitWorkstream,
      }),
    );
    codes.push(task.code);
  }
  // Tarefa sem frente não é de marco nenhum.
  await inTx(asOwner(), (t) =>
    createTask(t, { project: "VIT", title: "Solta" }),
  );
});

afterAll(async () => {
  await h.db.close();
});

describe("deriva prevista no banco (PRD §5.7)", () => {
  it("lê o ritmo e, por marco no prazo, a folga e as tarefas abertas das frentes dele", async () => {
    expect(await inTx(asOwner(), (t) => forecastInputsOf(t, h.vit))).toEqual({
      done_recent: 0,
      upcoming: [{ code: "M1", slack_days: 30, remaining: 3 }],
    });
    // Folga de 30 dias e nada concluído: ainda não acende.
    const far = await inTx(asOwner(), (t) => getProjectHealth(t, "VIT"));
    expect(far.inputs.drifting_milestones).toEqual([]);
  });

  it("perto da data e sem ritmo, o projeto fica amarelo, com o motivo", async () => {
    await h.raw.query(
      `update ${S}.milestones set due_date = current_date + 5 where id = $1`,
      [h.vitMilestone],
    );
    const health = await inTx(asOwner(), (t) => getProjectHealth(t, "VIT"));
    expect(health.health).toBe("attention");
    expect(health.reasons).toEqual([
      "O M1 vence em 5 dias com 3 tarefas abertas, e nada foi concluído nas últimas 2 semanas.",
    ]);
    expect(health.inputs).toMatchObject({
      tasks_done_last_14_days: 0,
      drifting_milestones: [
        { code: "M1", remaining: 3, slack_days: 5, needed_days: null },
      ],
    });
  });

  it("com ritmo, compara os dias necessários com a folga; o recálculo grava o sinal", async () => {
    await inTx(asOwner(), async (t) => {
      await completeTask(t, codes[0], { evidence: "Feito." });
      await completeTask(t, codes[1], { evidence: "Feito." });
    });
    // 2 em 14 dias: 1 tarefa a cada 7 dias; a que falta precisa de 7 e a folga é 5.
    const health = await inTx(asOwner(), (t) => getProjectHealth(t, "VIT"));
    expect(health.inputs.drifting_milestones).toEqual([
      { code: "M1", remaining: 1, slack_days: 5, needed_days: 7 },
    ]);
    await inTx(ctxFor(h, systemActor(h.ws), "cron"), (t) =>
      refreshAllHealth(t, new Date()),
    );
    const saved = await h.raw.query<{ health: string; health_reason: unknown }>(
      `select health, health_reason from ${S}.projects where id = $1`,
      [h.vit],
    );
    expect(saved.rows[0].health).toBe("attention");
    expect(saved.rows[0].health_reason).toMatchObject({
      signals: [{ kind: "drift_forecast" }],
    });

    // Com folga de sobra, o sinal sai.
    await h.raw.query(
      `update ${S}.milestones set due_date = current_date + 20 where id = $1`,
      [h.vitMilestone],
    );
    expect(
      (await inTx(asOwner(), (t) => getProjectHealth(t, "VIT"))).health,
    ).toBe("healthy");
  });
});
