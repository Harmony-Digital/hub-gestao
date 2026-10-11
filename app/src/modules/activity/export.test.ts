import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { inTx, maybeOne } from "@/modules/context";
import { createTask } from "@/modules/tasks/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { activityCsv, exportActivity, type ActivityRow } from "./export";

let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
let today = "";
let code = "";

beforeAll(async () => {
  h = await openTestHub();
  // Hoje no fuso do workspace, o mesmo do período da exportação (fora da transação, o
  // fuso do servidor muda o dia entre 0h e 3h UTC).
  today = await inTx(
    asOwner(),
    async (t) =>
      (await maybeOne<{ today: string }>(
        t,
        "select current_date::text as today",
      ))!.today,
  );
  const kratos = await agentActor(h, h.keys.kratos);
  code = (
    await inTx(ctxFor(h, kratos), (t) =>
      createTask(t, { project: "VIT", title: 'Revisar; o "roteiro"' }),
    )
  ).code;
});

afterAll(async () => {
  await h.db.close();
});

async function refusal(run: Promise<unknown>) {
  try {
    await run;
  } catch (err) {
    if (err instanceof HubError) return err.status;
    throw err;
  }
  throw new Error("Era para recusar.");
}

describe("exportação da atividade (RF-43)", () => {
  it("traz a atividade do projeto no período, legível", async () => {
    const data = await inTx(asOwner(), (t) =>
      exportActivity(t, { project: "VIT", from: today, to: today }),
    );
    expect(data.project_code).toBe("VIT");
    const created = data.items.find((i) => i.task_code === code)!;
    expect(created).toMatchObject({
      project_code: "VIT",
      actor_type: "agent",
      actor_name: "Kratos",
      source: "api",
      action: "task.created",
      description: `criou ${code}`,
    });
    // Fora do período, nada.
    const before = await inTx(asOwner(), (t) =>
      exportActivity(t, {
        project: "VIT",
        from: "2020-01-01",
        to: "2020-01-31",
      }),
    );
    expect(before.items).toEqual([]);
  });

  it("todos os projetos só para dono e administração; período com limites", async () => {
    const all = await inTx(asOwner(), (t) =>
      exportActivity(t, { from: today, to: today }),
    );
    expect(all.project_code).toBeNull();
    expect(all.items.length).toBeGreaterThan(0);
    const kratos = await agentActor(h, h.keys.kratos);
    expect(
      await refusal(
        inTx(ctxFor(h, kratos), (t) =>
          exportActivity(t, { from: today, to: today }),
        ),
      ),
    ).toBe(403);
    expect(
      await refusal(
        inTx(asOwner(), (t) =>
          exportActivity(t, {
            project: "VIT",
            from: "2026-10-10",
            to: "2026-10-01",
          }),
        ),
      ),
    ).toBe(422);
    expect(
      await refusal(
        inTx(asOwner(), (t) =>
          exportActivity(t, {
            project: "VIT",
            from: "2024-01-01",
            to: "2026-10-01",
          }),
        ),
      ),
    ).toBe(422);
  });

  it("o CSV abre na planilha: ponto e vírgula, BOM e aspas quando precisa", () => {
    const row: ActivityRow = {
      at: "2026-10-10T12:00:00.000Z",
      project_code: "VIT",
      actor_type: "agent",
      actor_name: "Kratos",
      acting_role: "GP-01",
      source: "mcp",
      action: "task.created",
      description: "criou HUB-1",
      entity_type: "task",
      entity_id: null,
      task_code: "HUB-1",
      detail: { title: 'Revisar; o "roteiro"\ncom calma' },
    };
    const csv = activityCsv([row]);
    expect(csv.startsWith("﻿quando;projeto;tipo de ator;quem;papel;")).toBe(
      true,
    );
    const line = csv.split("\r\n")[1];
    expect(line).toBe(
      '2026-10-10T12:00:00.000Z;VIT;agent;Kratos;GP-01;mcp;task.created;criou HUB-1;HUB-1;task;;"{""title"":""Revisar; o \\""roteiro\\""\\ncom calma""}"',
    );
  });
});
