import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { createTask } from "@/modules/tasks/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { projectChangeMarker } from "./live";

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

beforeAll(async () => {
  h = await openTestHub();
});

afterAll(async () => {
  await h.db.close();
});

describe("marca de mudança do projeto", () => {
  it("muda quando um agente grava no projeto e só nele", async () => {
    const before = await inTx(asOwner(), (t) => projectChangeMarker(t, "VIT"));
    const hubBefore = await inTx(asOwner(), (t) =>
      projectChangeMarker(t, "HUB"),
    );
    // Ler não muda a marca.
    expect(await inTx(asOwner(), (t) => projectChangeMarker(t, "VIT"))).toBe(
      before,
    );

    const kratos = await agentActor(h, h.keys.kratos);
    await inTx(ctxFor(h, kratos, "mcp"), (t) =>
      createTask(t, { project: "VIT", title: "Tarefa criada pelo agente" }),
    );
    const after = await inTx(asOwner(), (t) => projectChangeMarker(t, "VIT"));
    expect(after).not.toBe(before);
    expect(await inTx(asOwner(), (t) => projectChangeMarker(t, "HUB"))).toBe(
      hubBefore,
    );
  });

  it("segue a leitura de tarefas do projeto", async () => {
    const reader = await agentActor(h, h.keys.leitor);
    expect(
      await inTx(ctxFor(h, reader, "api"), (t) =>
        projectChangeMarker(t, "VIT"),
      ),
    ).toMatch(/^\d+\.\d+$/);
    // A chave do leitor vale só para o VIT.
    expect(
      (
        await hubError(
          inTx(ctxFor(h, reader, "api"), (t) => projectChangeMarker(t, "HUB")),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await hubError(
          inTx(asOwner(), (t) => projectChangeMarker(t, "NAOEXISTE")),
        )
      ).status,
    ).toBe(400);
    expect(
      (await hubError(inTx(asOwner(), (t) => projectChangeMarker(t, "ZZZ"))))
        .status,
    ).toBe(404);
  });
});
