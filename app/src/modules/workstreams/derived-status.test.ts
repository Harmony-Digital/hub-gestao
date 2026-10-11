import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inTx } from "@/modules/context";
import {
  blockTask,
  completeTask,
  createTask,
  reopenTask,
  startTask,
} from "@/modules/tasks/service";
import {
  createWorkstream,
  updateWorkstream,
} from "@/modules/workstreams/service";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";

const S = "proj_hub_gestao";
let h: TestHub;

beforeAll(async () => {
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});

const asOwner = () => ctxFor(h, h.owner_actor, "ui");

async function statusOf(id: string): Promise<string> {
  return (
    await h.raw.query<{ status: string }>(
      `select status::text as status from ${S}.workstreams where id = $1`,
      [id],
    )
  ).rows[0].status;
}

describe("status da frente derivado das tarefas (RF-12)", () => {
  it("segue as tarefas: planejada, em andamento, bloqueada e concluída", async () => {
    const front = await inTx(asOwner(), (t) =>
      createWorkstream(t, { project: "VIT", title: "Frente derivada" }),
    );
    // Sem tarefa: vale o status escolhido.
    await inTx(asOwner(), (t) =>
      updateWorkstream(t, front.id, { status: "in_progress" }),
    );
    expect(await statusOf(front.id)).toBe("in_progress");

    const a = await inTx(asOwner(), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Tarefa A",
        workstream_id: front.id,
      }),
    );
    const b = await inTx(asOwner(), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Tarefa B",
        workstream_id: front.id,
      }),
    );
    // Nenhuma começada: planejada (o status manual dá lugar ao das tarefas).
    expect(await statusOf(front.id)).toBe("planned");

    await inTx(asOwner(), (t) => startTask(t, a.code));
    expect(await statusOf(front.id)).toBe("in_progress");

    // A anda e B bloqueia: a frente continua em andamento.
    await inTx(asOwner(), (t) =>
      blockTask(t, b.code, { reason: "Falta a credencial." }),
    );
    expect(await statusOf(front.id)).toBe("in_progress");

    // A concluída, B bloqueada e nada andando: bloqueada.
    await inTx(asOwner(), (t) =>
      completeTask(t, a.code, { evidence: "https://exemplo.com/a" }),
    );
    expect(await statusOf(front.id)).toBe("blocked");

    // B reaberta (a fazer), com A concluída: em andamento.
    await inTx(asOwner(), (t) => reopenTask(t, b.code, {}));
    expect(await statusOf(front.id)).toBe("in_progress");

    // Tudo concluído: concluída.
    await inTx(asOwner(), (t) =>
      completeTask(t, b.code, { evidence: "https://exemplo.com/b" }),
    );
    expect(await statusOf(front.id)).toBe("done");
  });

  it("com tarefas, o status pedido na edição é ignorado", async () => {
    const front = await inTx(asOwner(), (t) =>
      createWorkstream(t, { project: "VIT", title: "Frente com tarefa" }),
    );
    await inTx(asOwner(), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Tarefa única",
        workstream_id: front.id,
      }),
    );
    const after = await inTx(asOwner(), (t) =>
      updateWorkstream(t, front.id, {
        status: "done",
        title: "Frente com tarefa (renomeada)",
      }),
    );
    expect(after.title).toBe("Frente com tarefa (renomeada)");
    expect(after.status).toBe("planned");
  });
});
