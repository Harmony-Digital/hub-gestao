import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { createTask } from "@/modules/tasks/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";
import {
  addAttachment,
  attachmentsOf,
  fileKind,
  MAX_ATTACHMENT_BYTES,
  readAttachment,
  removeAttachment,
} from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

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

describe("tipo do arquivo", () => {
  it("sai da extensão, sem caminho; HTML, SVG e executáveis ficam de fora", () => {
    expect(fileKind("C:\\fotos\\Tela 1.PNG")).toEqual({
      filename: "Tela 1.PNG",
      mime: "image/png",
    });
    expect(fileKind("../../relatorio.pdf")).toEqual({
      filename: "relatorio.pdf",
      mime: "application/pdf",
    });
    expect(fileKind("pagina.html")).toBeNull();
    expect(fileKind("logo.svg")).toBeNull();
    expect(fileKind("setup.exe")).toBeNull();
    expect(fileKind("sem-extensao")).toBeNull();
  });
});

describe("anexos da tarefa", () => {
  it("anexa, lista, baixa igual e tira, com histórico", async () => {
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Print da tela de agenda" }),
    );
    const added = await inTx(asOwner(), (t) =>
      addAttachment(t, task.code, { name: "agenda.png", bytes: PNG }),
    );
    expect(added).toMatchObject({
      filename: "agenda.png",
      mime: "image/png",
      size_bytes: PNG.length,
    });
    expect(
      (await inTx(asOwner(), (t) => attachmentsOf(t, task.id))).map(
        (a) => a.id,
      ),
    ).toEqual([added.id]);
    const file = await inTx(asOwner(), (t) => readAttachment(t, added.id));
    expect(new Uint8Array(file.content)).toEqual(PNG);

    // Quem só lê tarefas baixa, mas não anexa.
    const reader = await agentActor(h, h.keys.leitor);
    const read = await inTx(ctxFor(h, reader, "mcp"), (t) =>
      readAttachment(t, added.id),
    );
    expect(read.filename).toBe("agenda.png");
    expect(
      (
        await hubError(
          inTx(ctxFor(h, reader, "mcp"), (t) =>
            addAttachment(t, task.code, { name: "x.png", bytes: PNG }),
          ),
        )
      ).status,
    ).toBe(403);

    await inTx(asOwner(), (t) => removeAttachment(t, added.id));
    expect(await inTx(asOwner(), (t) => attachmentsOf(t, task.id))).toEqual([]);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.attachment_contents where attachment_id = $1`,
        [added.id],
      ),
    ).toBe(0);
    const actions = (
      await h.raw.query<{ action: string }>(
        `select action from ${S}.activity_log where entity_id = $1 and action like 'attachment.%' order by id`,
        [task.id],
      )
    ).rows.map((r) => r.action);
    expect(actions).toEqual(["attachment.added", "attachment.removed"]);
  });

  it("aceita até 25 MB (PRD §8.8): o limite antigo de 10 MB ficou para trás", async () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(25 * 1024 * 1024);
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Anexo grande" }),
    );
    const bytes = new Uint8Array(12 * 1024 * 1024).fill(0x61);
    const added = await inTx(asOwner(), (t) =>
      addAttachment(t, task.code, { name: "relatorio.txt", bytes }),
    );
    expect(added.size_bytes).toBe(bytes.length);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.attachment_contents
          where attachment_id = $1 and octet_length(content) = $2`,
        [added.id, bytes.length],
      ),
    ).toBe(1);
  });

  it("recusa tipo desconhecido, conteúdo que não bate, vazio e grande demais", async () => {
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Recusas" }),
    );
    const attach = (name: string, bytes: Uint8Array) =>
      hubError(
        inTx(asOwner(), (t) => addAttachment(t, task.code, { name, bytes })),
      );
    expect((await attach("pagina.html", PNG)).status).toBe(422);
    expect(
      (await attach("falso.png", new TextEncoder().encode("não sou png")))
        .status,
    ).toBe(422);
    expect(
      (await attach("binario.txt", new Uint8Array([0x61, 0x00, 0x62]))).status,
    ).toBe(422);
    expect((await attach("vazio.txt", new Uint8Array())).status).toBe(400);
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1).fill(0x61);
    expect((await attach("grande.txt", big)).status).toBe(422);
  });
});
