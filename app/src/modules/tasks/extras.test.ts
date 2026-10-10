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
  addChecklistItem,
  addDependency,
  checklistOf,
  dependenciesOf,
  removeChecklistItem,
  removeDependency,
  updateChecklistItem,
} from "./extras";
import { createTask } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

async function hubError(promise: Promise<unknown>): Promise<HubError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HubError);
  return err as HubError;
}

async function task(title: string) {
  return inTx(asOwner(), (t) => createTask(t, { project: "VIT", title }));
}

beforeAll(async () => {
  h = await openTestHub();
});

afterAll(async () => {
  await h.db.close();
});

describe("checklist da tarefa", () => {
  it("adiciona, marca, renomeia e remove, com o histórico de cada passo", async () => {
    const tk = await task("Preparar o roteiro");
    const a = await inTx(asOwner(), (t) =>
      addChecklistItem(t, tk.code, " Saudação "),
    );
    const b = await inTx(asOwner(), (t) =>
      addChecklistItem(t, tk.code, "Encerramento"),
    );
    expect(a).toMatchObject({ text: "Saudação", done: false });
    expect(b.sort_order).toBeGreaterThan(a.sort_order);

    await inTx(asOwner(), (t) => updateChecklistItem(t, a.id, { done: true }));
    await inTx(asOwner(), (t) =>
      updateChecklistItem(t, b.id, { text: "Despedida" }),
    );
    // Sem mudança: nada novo no histórico.
    await inTx(asOwner(), (t) => updateChecklistItem(t, a.id, { done: true }));
    await inTx(asOwner(), (t) => removeChecklistItem(t, b.id));

    const items = await inTx(asOwner(), (t) => checklistOf(t, tk.id));
    expect(items).toEqual([
      { id: a.id, text: "Saudação", done: true, sort_order: a.sort_order },
    ]);
    const actions = (
      await h.raw.query<{ action: string }>(
        `select action from ${S}.activity_log
          where entity_id = $1 and action like 'checklist.%' order by id`,
        [tk.id],
      )
    ).rows.map((r) => r.action);
    expect(actions).toEqual([
      "checklist.added",
      "checklist.added",
      "checklist.checked",
      "checklist.renamed",
      "checklist.removed",
    ]);
  });

  it("recusa texto vazio ou com cara de segredo e chave só de leitura", async () => {
    const tk = await task("Revisar textos");
    expect(
      (
        await hubError(
          inTx(asOwner(), (t) => addChecklistItem(t, tk.code, " ")),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await hubError(
          inTx(asOwner(), (t) =>
            addChecklistItem(
              t,
              tk.code,
              "token sk-ant-api03-abcdefghijklmnopqrstuv",
            ),
          ),
        )
      ).status,
    ).toBe(422);
    const reader = await agentActor(h, h.keys.leitor);
    expect(
      (
        await hubError(
          inTx(ctxFor(h, reader, "mcp"), (t) =>
            addChecklistItem(t, tk.code, "Não entra"),
          ),
        )
      ).status,
    ).toBe(403);
  });
});

describe("dependências entre tarefas", () => {
  it("liga, lista nos dois sentidos e desliga", async () => {
    const api = await task("Liberar a API da agenda");
    const integ = await task("Integrar a agenda");
    await inTx(asOwner(), (t) => addDependency(t, integ.code, api.code));
    const deps = await inTx(asOwner(), async (t) => ({
      integ: await dependenciesOf(t, integ.id),
      api: await dependenciesOf(t, api.id),
    }));
    expect(deps.integ.blocked_by.map((d) => d.code)).toEqual([api.code]);
    expect(deps.api.blocks.map((d) => d.code)).toEqual([integ.code]);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log where action = 'dependency.added' and entity_id = $1`,
        [integ.id],
      ),
    ).toBe(1);

    await inTx(asOwner(), (t) => removeDependency(t, integ.code, api.code));
    const after = await inTx(asOwner(), (t) => dependenciesOf(t, integ.id));
    expect(after.blocked_by).toEqual([]);
    expect(
      (
        await hubError(
          inTx(asOwner(), (t) => removeDependency(t, integ.code, api.code)),
        )
      ).status,
    ).toBe(404);
  });

  it("recusa a própria tarefa, repetição e ciclo", async () => {
    const a = await task("Etapa A");
    const b = await task("Etapa B");
    const c = await task("Etapa C");
    expect(
      (await hubError(inTx(asOwner(), (t) => addDependency(t, a.code, a.code))))
        .status,
    ).toBe(400);
    // C depende de B, B depende de A.
    await inTx(asOwner(), async (t) => {
      await addDependency(t, c.code, b.code);
      await addDependency(t, b.code, a.code);
    });
    expect(
      (await hubError(inTx(asOwner(), (t) => addDependency(t, c.code, b.code))))
        .status,
    ).toBe(409);
    // A depender de C fecharia o laço A → B → C → A.
    const cycle = await hubError(
      inTx(asOwner(), (t) => addDependency(t, a.code, c.code)),
    );
    expect(cycle.status).toBe(422);
    expect(cycle.detail).toMatch(/ciclo/);
  });
});
