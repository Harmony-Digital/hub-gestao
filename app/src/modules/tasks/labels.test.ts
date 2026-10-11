import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { toHubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { projectTaskList, taskDetail } from "./board";
import { LABEL_PALETTE, listLabels, removeLabel, updateLabel } from "./labels";
import { createTask, getTask, listTasks, updateTask } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
let member: UserActor;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

beforeAll(async () => {
  h = await openTestHub();
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('rui.etiqueta@exemplo.com', 'Rui') returning id`,
    )
  ).rows[0];
  await h.raw.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'member')`,
    [h.ws, profile.id],
  );
  member = {
    type: "user",
    id: profile.id,
    scope: "internal",
    role: "member",
    workspaceId: h.ws,
    name: "Rui",
  };
});

afterAll(async () => {
  await h.db.close();
});

const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 0,
    // Erro de formato (zod) vira 400 na API e na tela, como aqui.
    (e: unknown) => toHubError(e).status,
  );

describe("etiquetas das tarefas (RF-18)", () => {
  it("põe pelo nome, cria as novas com cor da paleta e reaproveita sem diferenciar maiúsculas", async () => {
    const task = await inTx(asOwner(), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Com etiquetas",
        labels: ["Urgente"],
      }),
    );
    expect(task.labels).toEqual([{ name: "Urgente", color: LABEL_PALETTE[0] }]);
    const updated = await inTx(asOwner(), (t) =>
      updateTask(
        t,
        task.code,
        { labels: ["  urgente ", "Cliente   esperando", "URGENTE"] },
        task.version,
      ),
    );
    expect(updated.labels.map((l) => l.name)).toEqual([
      "Cliente esperando",
      "Urgente",
    ]);
    expect(updated.version).toBeGreaterThan(task.version);
    // A segunda etiqueta ganha a próxima cor da paleta.
    expect(updated.labels[0].color).toBe(LABEL_PALETTE[1]);
    // Mesma lista: nada muda, nem a versão.
    const same = await inTx(asOwner(), (t) =>
      updateTask(t, task.code, { labels: ["Urgente", "cliente esperando"] }),
    );
    expect(same.version).toBe(updated.version);

    // O histórico diz o que mudou.
    const detail = await inTx(asOwner(), (t) => taskDetail(t, task.code));
    expect(detail.history.map((e) => e.text)).toContain(
      "mudou as etiquetas para Cliente esperando e Urgente",
    );
    expect(detail.labels.map((l) => l.name)).toEqual([
      "Cliente esperando",
      "Urgente",
    ]);

    // Tirar todas.
    const none = await inTx(asOwner(), (t) =>
      updateTask(t, task.code, { labels: [] }),
    );
    expect(none.labels).toEqual([]);
    expect(
      (await inTx(asOwner(), (t) => taskDetail(t, task.code))).history[0].text,
    ).toBe("tirou as etiquetas");
  });

  it("filtra pela etiqueta na Lista e na API; o agente põe etiqueta como uma pessoa", async () => {
    const kratos = await agentActor(h, h.keys.kratos);
    const tagged = await inTx(ctxFor(h, kratos, "mcp"), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Do agente",
        labels: ["Revisar"],
      }),
    );
    const plain = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Sem etiqueta" }),
    );
    const list = await inTx(asOwner(), (t) =>
      projectTaskList(t, "VIT", { label: "revisar" }),
    );
    expect(list.tasks.map((t) => t.code)).toEqual([tagged.code]);
    expect(list.labels.map((l) => l.name)).toContain("Revisar");
    const api = await inTx(ctxFor(h, kratos, "api"), (t) =>
      listTasks(t, { project: "VIT", label: "REVISAR" }),
    );
    expect(api.items.map((t) => t.code)).toEqual([tagged.code]);
    expect(api.items.map((t) => t.code)).not.toContain(plain.code);
  });

  it("recusa mais de 10, vírgula e nome longo", async () => {
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Limites" }),
    );
    const set = (labels: string[]) =>
      status(inTx(asOwner(), (t) => updateTask(t, task.code, { labels })));
    expect(
      await set(Array.from({ length: 11 }, (_, i) => `Etiqueta ${i}`)),
    ).toBe(400);
    expect(await set(["a,b"])).toBe(400);
    expect(await set(["x".repeat(41)])).toBe(400);
    expect(await set([""])).toBe(400);
  });

  it("renomear, mudar a cor e remover é do dono e da administração", async () => {
    const [urgente] = (await inTx(asOwner(), (t) => listLabels(t))).filter(
      (l) => l.name === "Urgente",
    );
    expect(
      await status(
        inTx(ctxFor(h, member, "ui"), (t) =>
          updateLabel(t, urgente.id, {
            name: "Muito urgente",
            color: "#000000",
          }),
        ),
      ),
    ).toBe(403);
    expect(
      await status(
        inTx(asOwner(), (t) =>
          updateLabel(t, urgente.id, { name: "revisar", color: "#000000" }),
        ),
      ),
    ).toBe(409);
    await inTx(asOwner(), (t) =>
      updateLabel(t, urgente.id, { name: "Prioridade", color: "#123abc" }),
    );
    const task = await inTx(asOwner(), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Renomeada",
        labels: ["prioridade"],
      }),
    );
    expect(task.labels).toEqual([{ name: "Prioridade", color: "#123ABC" }]);
    expect(
      await status(
        inTx(ctxFor(h, member, "ui"), (t) => removeLabel(t, urgente.id)),
      ),
    ).toBe(403);
    await inTx(asOwner(), (t) => removeLabel(t, urgente.id));
    expect(
      (await inTx(asOwner(), (t) => getTask(t, task.code))).labels,
    ).toEqual([]);
    expect(
      await status(inTx(asOwner(), (t) => removeLabel(t, urgente.id))),
    ).toBe(404);
  });
});
