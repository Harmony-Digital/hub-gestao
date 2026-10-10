import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { inTx } from "@/modules/context";
import type { TaskSummary } from "@/modules/projects/schemas";
import { completeTask, createTask, startTask } from "@/modules/tasks/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { bucketByDue, myTasks } from "./mine";

const S = "proj_hub_gestao";
let h: TestHub;
let outsider: UserActor;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

beforeAll(async () => {
  h = await openTestHub();
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('caio@exemplo.com', 'Caio') returning id`,
    )
  ).rows[0];
  await h.raw.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'member')`,
    [h.ws, profile.id],
  );
  outsider = {
    type: "user",
    id: profile.id,
    scope: "internal",
    role: "member",
    workspaceId: h.ws,
    name: "Caio",
  };
});

afterAll(async () => {
  await h.db.close();
});

describe("Minhas tarefas", () => {
  it("traz as abertas e as concluídas recentes de quem vê, de todos os projetos", async () => {
    const mine = (title: string, due?: string) =>
      inTx(asOwner(), (t) =>
        createTask(t, {
          project: "VIT",
          title,
          assignee: { type: "user", id: h.owner },
          ...(due ? { due_date: due } : {}),
        }),
      );
    const later = await mine("Depois", "2099-01-10");
    const noDue = await mine("Sem data");
    const finished = await mine("Feita");
    await inTx(asOwner(), (t) => startTask(t, finished.code));
    await inTx(asOwner(), (t) =>
      completeTask(t, finished.code, { evidence: "https://exemplo.com/ok" }),
    );
    // Tarefa de outra pessoa não aparece.
    const kratos = await agentActor(h, h.keys.kratos);
    await inTx(ctxFor(h, kratos, "mcp"), (t) =>
      createTask(t, { project: "VIT", title: "Do agente" }),
    );

    const data = await inTx(asOwner(), (t) => myTasks(t));
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.open.map((x) => x.code)).toEqual([later.code, noDue.code]);
    expect(data.done.map((x) => x.code)).toEqual([finished.code]);
    expect(data.projects).toEqual([{ code: "VIT", name: expect.any(String) }]);

    // Quem não participa do projeto não vê nada dele.
    const other = await inTx(ctxFor(h, outsider, "ui"), (t) => myTasks(t));
    expect(other.open).toEqual([]);
  });
});

describe("grupos pela data", () => {
  const task = (code: string, due: string | null): TaskSummary => ({
    code,
    project_code: "VIT",
    title: code,
    status_name: "A fazer",
    status_category: "todo",
    priority: "normal",
    assignee: null,
    due_date: due,
    blocked_reason: null,
    blocked_on: null,
    parent_code: null,
  });

  it("separa atrasadas, hoje, próximos 7 dias, mais adiante e sem prazo", () => {
    const groups = bucketByDue(
      [
        task("A", "2026-10-01"),
        task("B", "2026-10-10"),
        task("C", "2026-10-17"),
        task("D", "2026-10-18"),
        task("E", null),
      ],
      "2026-10-10",
    );
    expect(groups.map((g) => [g.key, g.tasks.map((x) => x.code)])).toEqual([
      ["atrasadas", ["A"]],
      ["hoje", ["B"]],
      ["semana", ["C"]],
      ["depois", ["D"]],
      ["sem-prazo", ["E"]],
    ]);
    expect(bucketByDue([], "2026-10-10")).toEqual([]);
  });
});
