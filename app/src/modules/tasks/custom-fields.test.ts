import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";
import {
  createField,
  listProjectFields,
  removeField,
  updateField,
} from "./custom-fields";
import { createTask, getTask, updateTask } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
let code = "";

beforeAll(async () => {
  h = await openTestHub();
  code = (
    await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Atender pelo WhatsApp" }),
    )
  ).code;
});

afterAll(async () => {
  await h.db.close();
});

async function status(run: Promise<unknown>) {
  try {
    await run;
  } catch (err) {
    if (err instanceof HubError)
      return { status: err.status, message: err.message };
    throw err;
  }
  throw new Error("Era para recusar.");
}

describe("campos personalizados das tarefas (RF-19)", () => {
  it("o dono define os campos do projeto, na ordem, sem nome repetido", async () => {
    await inTx(asOwner(), async (t) => {
      await createField(t, "VIT", {
        name: "Canal",
        kind: "select",
        options: ["Site", "WhatsApp", "Site"],
      });
      await createField(t, "VIT", {
        name: "Valor",
        kind: "number",
        options: [],
      });
      await createField(t, "VIT", {
        name: "Entrega",
        kind: "date",
        options: [],
      });
      await createField(t, "VIT", {
        name: "Briefing",
        kind: "url",
        options: [],
      });
    });
    const fields = await inTx(asOwner(), (t) => listProjectFields(t, "VIT"));
    expect(fields.map((f) => [f.name, f.kind, f.options])).toEqual([
      ["Canal", "select", ["Site", "WhatsApp"]],
      ["Valor", "number", []],
      ["Entrega", "date", []],
      ["Briefing", "url", []],
    ]);
    expect(
      await status(
        inTx(asOwner(), (t) =>
          createField(t, "VIT", { name: "canal", kind: "text", options: [] }),
        ),
      ),
    ).toMatchObject({ status: 409 });
    expect(
      await status(
        inTx(asOwner(), (t) =>
          createField(t, "VIT", { name: "Plano", kind: "select", options: [] }),
        ),
      ),
    ).toMatchObject({ status: 422 });
  });

  it("o valor entra pela atualização da tarefa, pelo nome, já conferido", async () => {
    const before = await inTx(asOwner(), (t) => getTask(t, code));
    const after = await inTx(asOwner(), (t) =>
      updateTask(t, code, {
        custom_fields: {
          canal: "WhatsApp",
          Valor: "1.250,5",
          Entrega: "2026-11-30",
          Briefing: "https://exemplo.com/briefing",
        },
      }),
    );
    expect(after.custom_fields).toEqual({
      Canal: "WhatsApp",
      Valor: "1250.5",
      Entrega: "2026-11-30",
      Briefing: "https://exemplo.com/briefing",
    });
    expect(after.version).toBe(before.version + 1);
    // Mesmo valor de novo: nada muda, nem a versão.
    const same = await inTx(asOwner(), (t) =>
      updateTask(t, code, { custom_fields: { Valor: 1250.5 } }),
    );
    expect(same.version).toBe(after.version);
    // Vazio tira o valor.
    const cleared = await inTx(asOwner(), (t) =>
      updateTask(t, code, { custom_fields: { Briefing: null } }),
    );
    expect(cleared.custom_fields).not.toHaveProperty("Briefing");
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log
          where action = 'task.updated' and after ? 'custom_fields'`,
      ),
    ).toBe(2);
  });

  it("recusa valor fora do tipo, opção que não existe e campo desconhecido", async () => {
    const bad = (values: Record<string, string>) =>
      status(
        inTx(asOwner(), (t) => updateTask(t, code, { custom_fields: values })),
      );
    expect(await bad({ Valor: "doze" })).toEqual({
      status: 422,
      message: "Valor: escreva um número, como 1250 ou 12,5.",
    });
    expect(await bad({ Canal: "Telefone" })).toMatchObject({ status: 422 });
    expect(await bad({ Prazo: "2026-01-01" })).toMatchObject({ status: 422 });
  });

  it("agente grava o valor pela chave; definir campo é de pessoa", async () => {
    const kratos = ctxFor(h, await agentActor(h, h.keys.kratos), "mcp");
    const task = await inTx(kratos, (t) =>
      updateTask(t, code, { custom_fields: { Canal: "Site" } }),
    );
    expect(task.custom_fields.Canal).toBe("Site");
    expect(
      await status(
        inTx(kratos, (t) =>
          createField(t, "VIT", { name: "Outro", kind: "text", options: [] }),
        ),
      ),
    ).toMatchObject({ status: 403 });
  });

  it("renomeia, não tira opção em uso e remove o campo com os valores", async () => {
    const fields = await inTx(asOwner(), (t) => listProjectFields(t, "VIT"));
    const canal = fields.find((f) => f.name === "Canal")!;
    expect(
      await status(
        inTx(asOwner(), (t) =>
          updateField(t, canal.id, { name: "Canal", options: ["WhatsApp"] }),
        ),
      ),
    ).toEqual({
      status: 422,
      message:
        "A opção “Site” (1 tarefa) ainda está em uso: troque nas tarefas antes de tirar.",
    });
    await inTx(asOwner(), (t) =>
      updateField(t, canal.id, {
        name: "Canal de entrada",
        options: ["Site", "WhatsApp", "Indicação"],
      }),
    );
    expect(
      (await inTx(asOwner(), (t) => getTask(t, code))).custom_fields,
    ).toHaveProperty("Canal de entrada", "Site");
    const removed = await inTx(asOwner(), (t) => removeField(t, canal.id));
    expect(removed).toEqual({ name: "Canal de entrada", values: 1 });
    expect(
      (await inTx(asOwner(), (t) => getTask(t, code))).custom_fields,
    ).not.toHaveProperty("Canal de entrada");
  });
});
