import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inTx } from "@/modules/context";
import { blockTask, completeTask, createTask } from "@/modules/tasks/service";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { periodFacts } from "./summary";

let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

beforeAll(async () => {
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});

describe("fatos do período para o relatório", () => {
  it("traz as tarefas concluídas no período, as bloqueadas e o próximo marco", async () => {
    const feita = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Resumo: tarefa feita" }),
    );
    await inTx(asOwner(), (t) =>
      completeTask(t, feita.code, { evidence: "Feita no teste." }),
    );
    const parada = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Resumo: tarefa parada" }),
    );
    await inTx(asOwner(), (t) =>
      blockTask(t, parada.code, { reason: "Falta o acesso." }),
    );
    const facts = await inTx(asOwner(), (t) =>
      periodFacts(t, "VIT", "2000-01-01", "2100-01-01"),
    );
    expect(facts.completed.map((c) => c.code)).toContain(feita.code);
    expect(facts.blocked).toContainEqual({
      code: parada.code,
      title: "Resumo: tarefa parada",
      reason: "Falta o acesso.",
    });
    expect(facts.next?.code).toMatch(/^M\d+$/);
    // Fora do período, nada concluído entra.
    const before = await inTx(asOwner(), (t) =>
      periodFacts(t, "VIT", "2000-01-01", "2000-01-07"),
    );
    expect(before.completed).toEqual([]);
  });
});
