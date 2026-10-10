import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { projectTaskList } from "@/modules/tasks/board";
import { createTask, getTask } from "@/modules/tasks/service";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";
import {
  createStatus,
  projectStatusesAdmin,
  removeStatus,
  reorderStatuses,
  updateStatus,
} from "./statuses";

let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asRole = (role: UserActor["role"]) =>
  ctxFor(h, { ...h.owner_actor, role }, "ui");

async function status(promise: Promise<unknown>): Promise<number> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HubError);
  return (err as HubError).status;
}

beforeAll(async () => {
  h = await openTestHub();
});

afterAll(async () => {
  await h.db.close();
});

describe("status do projeto", () => {
  it("cria, renomeia, muda a cor, torna padrão e reordena, com histórico", async () => {
    const before = await inTx(asOwner(), (t) => projectStatusesAdmin(t, "VIT"));
    expect(before.map((s) => s.category)).toEqual([
      "todo",
      "in_progress",
      "review",
      "blocked",
      "done",
    ]);

    const qa = await inTx(asOwner(), (t) =>
      createStatus(t, "VIT", {
        name: "Em teste",
        category: "review",
        color: "#7e5cc4",
      }),
    );
    expect(qa).toMatchObject({
      name: "Em teste",
      category: "review",
      color: "#7E5CC4",
      isDefault: false,
      tasks: 0,
    });
    // Nome repetido (sem diferenciar maiúscula) é recusado.
    expect(
      await status(
        inTx(asOwner(), (t) =>
          createStatus(t, "VIT", {
            name: "em TESTE",
            category: "todo",
            color: "#000000",
          }),
        ),
      ),
    ).toBe(409);

    expect(
      await inTx(asOwner(), (t) =>
        updateStatus(t, qa.id, { name: "Homologação", color: "#3B6FB6" }),
      ),
    ).toEqual(["name", "color"]);
    expect(
      await inTx(asOwner(), (t) =>
        updateStatus(t, qa.id, { name: "Homologação" }),
      ),
    ).toEqual([]);
    // Só "A fazer" pode ser o padrão.
    expect(
      await status(
        inTx(asOwner(), (t) => updateStatus(t, qa.id, { make_default: true })),
      ),
    ).toBe(422);

    const backlog = await inTx(asOwner(), (t) =>
      createStatus(t, "VIT", {
        name: "Backlog",
        category: "todo",
        color: "#8E93A3",
      }),
    );
    await inTx(asOwner(), (t) =>
      updateStatus(t, backlog.id, { make_default: true }),
    );
    // Tarefa nova começa no padrão novo.
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Começa no Backlog" }),
    );
    expect(task.status.name).toBe("Backlog");

    const all = await inTx(asOwner(), (t) => projectStatusesAdmin(t, "VIT"));
    const order = [
      backlog.id,
      ...all.filter((s) => s.id !== backlog.id).map((s) => s.id),
    ];
    expect(
      await inTx(asOwner(), (t) => reorderStatuses(t, "VIT", order)),
    ).toBeGreaterThan(0);
    const board = await inTx(asOwner(), (t) =>
      projectTaskList(t, "VIT", {
        workstream: null,
        assignee: null,
        priorities: [],
        due: null,
        search: null,
      }),
    );
    expect(board.statuses[0].name).toBe("Backlog");
    // Ordem incompleta é recusada.
    expect(
      await status(
        inTx(asOwner(), (t) => reorderStatuses(t, "VIT", order.slice(1))),
      ),
    ).toBe(422);

    const actions = (
      await h.raw.query<{ action: string }>(
        `select action from proj_hub_gestao.activity_log
          where entity_type = 'project' and entity_id = $1 and action like 'status%'
          order by id`,
        [h.vit],
      )
    ).rows.map((r) => r.action);
    expect(actions).toEqual([
      "status.created",
      "status.updated",
      "status.created",
      "status.updated",
      "statuses.reordered",
    ]);
  });

  it("remove só com outro da mesma categoria, movendo as tarefas", async () => {
    const list = await inTx(asOwner(), (t) => projectStatusesAdmin(t, "VIT"));
    const blocked = list.find((s) => s.category === "blocked")!;
    // Único da categoria: não sai.
    expect(
      await status(inTx(asOwner(), (t) => removeStatus(t, blocked.id))),
    ).toBe(422);
    // Padrão: não sai sem outro padrão.
    const def = list.find((s) => s.isDefault)!;
    expect(await status(inTx(asOwner(), (t) => removeStatus(t, def.id)))).toBe(
      422,
    );

    const doing = list.find((s) => s.category === "in_progress")!;
    const extra = await inTx(asOwner(), (t) =>
      createStatus(t, "VIT", {
        name: "Fazendo agora",
        category: "in_progress",
        color: "#3B6FB6",
      }),
    );
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Vai mudar de status" }),
    );
    await h.raw.query(
      `update proj_hub_gestao.tasks set status_id = $2 where code = $1`,
      [task.code, extra.id],
    );
    // Com tarefas, precisa do destino da mesma categoria.
    expect(
      await status(inTx(asOwner(), (t) => removeStatus(t, extra.id))),
    ).toBe(422);
    expect(
      await status(
        inTx(asOwner(), (t) => removeStatus(t, extra.id, blocked.id)),
      ),
    ).toBe(422);
    await inTx(asOwner(), (t) => removeStatus(t, extra.id, doing.id));
    const moved = await inTx(asOwner(), (t) => getTask(t, task.code));
    expect(moved.status.id).toBe(doing.id);
    expect(
      (await inTx(asOwner(), (t) => projectStatusesAdmin(t, "VIT"))).some(
        (s) => s.id === extra.id,
      ),
    ).toBe(false);
  });

  it("só o dono e a administração mexem nos status", async () => {
    expect(
      await status(
        inTx(asRole("member"), (t) =>
          createStatus(t, "VIT", {
            name: "Outro",
            category: "todo",
            color: "#000000",
          }),
        ),
      ),
    ).toBe(403);
    const list = await inTx(asOwner(), (t) => projectStatusesAdmin(t, "VIT"));
    expect(
      await status(
        inTx(asRole("member"), (t) =>
          updateStatus(t, list[0].id, { name: "Renomeado" }),
        ),
      ),
    ).toBe(403);
  });
});
