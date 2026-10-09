import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentActor } from "@/lib/db/actor";
import { withIdempotency } from "@/lib/idempotency";
import { inTx } from "@/modules/context";
import {
  blockTask,
  completeTask,
  createTask,
  getTask,
  listTasks,
  reopenTask,
  startTask,
  updateTask,
} from "@/modules/tasks/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";

const S = "proj_hub_gestao";
let h: TestHub;
let kratos: AgentActor;

beforeAll(async () => {
  h = await openTestHub();
  kratos = await agentActor(h, h.keys.kratos);
});
afterAll(async () => {
  await h.db.close();
});

const asKratos = () => ctxFor(h, kratos, "mcp");

describe("tarefas por agente", () => {
  it("cria com código HUB-n, origem do canal, auditoria e progresso recalculado", async () => {
    const task = await inTx(asKratos(), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Configurar o número do WhatsApp",
        workstream_id: h.vitWorkstream,
        priority: "high",
      }),
    );
    expect(task.code).toMatch(/^HUB-\d+$/);
    expect(task.status.category).toBe("todo");
    expect(task.source).toBe("mcp");
    expect(task.created_by).toEqual({
      type: "agent",
      id: kratos.id,
      name: "Kratos",
    });
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log where action = 'task.created' and entity_id = $1`,
        [task.id],
      ),
    ).toBe(1);
    expect(
      await count(
        h,
        `select task_count as n from ${S}.workstreams where id = $1`,
        [h.vitWorkstream],
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it("fica nos projetos da chave", async () => {
    await expect(
      inTx(asKratos(), (t) =>
        createTask(t, { project: "HUB", title: "Fora do escopo" }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("ciclo completo: iniciar, bloquear, concluir só com evidência, reabrir", async () => {
    const task = await inTx(asKratos(), (t) =>
      createTask(t, { project: "VIT", title: "Testar o fluxo" }),
    );
    const started = await inTx(asKratos(), (t) => startTask(t, task.code));
    expect(started.status.category).toBe("in_progress");
    expect(started.assignee?.id).toBe(kratos.id);

    const blocked = await inTx(asKratos(), (t) =>
      blockTask(t, task.code, {
        reason: "Falta o acesso à conta da Meta, que depende do cliente.",
      }),
    );
    expect(blocked.status.category).toBe("blocked");

    await expect(
      inTx(asKratos(), (t) => completeTask(t, task.code, { evidence: " " })),
    ).rejects.toMatchObject({ status: 422 });

    const done = await inTx(asKratos(), (t) =>
      completeTask(t, task.code, {
        evidence: "commit 3f9a2c1, teste de ponta a ponta verde",
      }),
    );
    expect(done.status.category).toBe("done");
    expect(done.completed_by?.id).toBe(kratos.id);
    expect(done.blocked_reason).toBeNull();

    await expect(
      inTx(asKratos(), (t) =>
        completeTask(t, task.code, { evidence: "de novo" }),
      ),
    ).rejects.toMatchObject({ status: 409 });

    const reopened = await inTx(asKratos(), (t) =>
      reopenTask(t, task.code, { reason: "A evidência não mostra o teste." }),
    );
    expect(reopened.status.category).toBe("todo");
    expect(reopened.done_evidence).toBeNull();
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.comments where entity_id = $1 and body_md like 'Reaberta:%'`,
        [task.id],
      ),
    ).toBe(1);
  });

  it("um agente tem uma tarefa em andamento por vez", async () => {
    const a = await inTx(asKratos(), (t) =>
      createTask(t, { project: "VIT", title: "Primeira" }),
    );
    const b = await inTx(asKratos(), (t) =>
      createTask(t, { project: "VIT", title: "Segunda" }),
    );
    await inTx(asKratos(), (t) => startTask(t, a.code));
    await expect(
      inTx(asKratos(), (t) => startTask(t, b.code)),
    ).rejects.toMatchObject({
      status: 409,
      extra: { in_progress: [a.code] },
    });
    await inTx(asKratos(), (t) =>
      completeTask(t, a.code, { evidence: "PR #3" }),
    );
    await expect(
      inTx(asKratos(), (t) => startTask(t, b.code)),
    ).resolves.toMatchObject({
      status: { category: "in_progress" },
    });
    await inTx(asKratos(), (t) =>
      blockTask(t, b.code, { reason: "aguardando revisão" }),
    );
  });

  it("não pega tarefa de outro responsável", async () => {
    const ownerCtx = ctxFor(h, h.owner_actor, "ui");
    const task = await inTx(ownerCtx, (t) =>
      createTask(t, { project: "VIT", title: "Do Fábio", assignee: "me" }),
    );
    await expect(
      inTx(asKratos(), (t) => startTask(t, task.code)),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it("atualiza com controle de versão e audita só o que mudou", async () => {
    const task = await inTx(asKratos(), (t) =>
      createTask(t, { project: "VIT", title: "Versão 1" }),
    );
    const updated = await inTx(asKratos(), (t) =>
      updateTask(
        t,
        task.code,
        { title: "Versão 2", status: "Em revisão" },
        task.version,
      ),
    );
    expect(updated.version).toBe(task.version + 1);
    expect(updated.status.category).toBe("review");
    await expect(
      inTx(asKratos(), (t) =>
        updateTask(t, task.code, { title: "Atrasada" }, task.version),
      ),
    ).rejects.toMatchObject({
      status: 412,
      extra: { current_version: updated.version },
    });
    await expect(
      inTx(asKratos(), (t) =>
        updateTask(t, task.code, { status: "Concluída" }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    const log = await h.raw.query<{
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }>(
      `select before, after from ${S}.activity_log where action = 'task.updated' and entity_id = $1`,
      [task.id],
    );
    expect(log.rows[0].before).toEqual({
      title: "Versão 1",
      status: "A fazer",
    });
    expect(log.rows[0].after).toEqual({
      title: "Versão 2",
      status: "Em revisão",
    });
  });

  it("recusa segredo em texto livre", async () => {
    await expect(
      inTx(asKratos(), (t) =>
        createTask(t, {
          project: "VIT",
          title: "Usar a chave sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        }),
      ),
    ).rejects.toMatchObject({ status: 422, extra: { field: "title" } });
  });

  it("lista com filtros e pagina por cursor sem repetir", async () => {
    for (let i = 0; i < 5; i++) {
      await inTx(asKratos(), (t) =>
        createTask(t, { project: "VIT", title: `Paginação ${i}` }),
      );
    }
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await inTx(asKratos(), (t) =>
        listTasks(t, { project: "VIT", limit: 3, cursor }),
      );
      for (const item of page.items) {
        expect(seen.has(item.code)).toBe(false);
        seen.add(item.code);
      }
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    const total = await count(
      h,
      `select count(*)::int as n from ${S}.tasks where project_id = $1`,
      [h.vit],
    );
    expect(seen.size).toBe(total);

    const blocked = await inTx(asKratos(), (t) =>
      listTasks(t, { project: "VIT", blocked: true }),
    );
    expect(blocked.items.every((x) => x.status.category === "blocked")).toBe(
      true,
    );
    const mine = await inTx(asKratos(), (t) =>
      listTasks(t, { assignee: "me" }),
    );
    expect(mine.items.every((x) => x.assignee?.id === kratos.id)).toBe(true);
  });

  it("subtarefa tem um nível só e herda a frente", async () => {
    const parent = await inTx(asKratos(), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Pai",
        workstream_id: h.vitWorkstream,
      }),
    );
    const child = await inTx(asKratos(), (t) =>
      createTask(t, { project: "VIT", title: "Filha", parent: parent.code }),
    );
    expect(child.parent_code).toBe(parent.code);
    expect(child.workstream?.id).toBe(h.vitWorkstream);
    await expect(
      inTx(asKratos(), (t) =>
        createTask(t, { project: "VIT", title: "Neta", parent: child.code }),
      ),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("idempotência no banco", () => {
  it("mesma chave e mesmo pedido devolvem a mesma resposta; pedido diferente é conflito", async () => {
    const run = (title: string, hash: string) =>
      inTx(asKratos(), (t) =>
        withIdempotency(t, "chave-de-teste-0001", hash, async () => ({
          status: 201,
          body: await createTask(t, { project: "VIT", title }),
        })),
      );
    const first = await run("Idempotente", "hash-a");
    const again = await run("Idempotente", "hash-a");
    expect(again.replayed).toBe(true);
    expect((again.response.body as { code: string }).code).toBe(
      (first.response.body as { code: string }).code,
    );
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.tasks where title = 'Idempotente'`,
      ),
    ).toBe(1);
    await expect(run("Outra", "hash-b")).rejects.toMatchObject({ status: 409 });
  });

  it("falha não fica guardada: a mesma chave pode tentar de novo", async () => {
    const attempt = (project: string) =>
      inTx(asKratos(), (t) =>
        withIdempotency(t, "chave-de-teste-0002", "hash-c", async () => ({
          status: 201,
          body: await createTask(t, { project, title: "Depois do erro" }),
        })),
      );
    await expect(attempt("HUB")).rejects.toMatchObject({ status: 403 });
    await expect(attempt("VIT")).resolves.toMatchObject({ replayed: false });
  });
});

describe("leitura", () => {
  it("chave só de leitura lê, mas não escreve", async () => {
    const leitor = await agentActor(h, h.keys.leitor);
    const list = await inTx(ctxFor(h, leitor), (t) =>
      listTasks(t, { project: "VIT" }),
    );
    expect(list.items.length).toBeGreaterThan(0);
    const code = list.items[0].code;
    await expect(
      inTx(ctxFor(h, leitor), (t) => getTask(t, code)),
    ).resolves.toMatchObject({ code });
    await expect(
      inTx(ctxFor(h, leitor), (t) =>
        createTask(t, { project: "VIT", title: "Não pode" }),
      ),
    ).rejects.toMatchObject({
      status: 403,
      extra: { missing_scope: "tasks:write" },
    });
  });
});
