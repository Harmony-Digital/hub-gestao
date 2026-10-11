import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import { createComment } from "@/modules/comments/service";
import { inTx } from "@/modules/context";
import { archiveWorkstream } from "@/modules/archive/service";
import { createWorkstream } from "@/modules/workstreams/service";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";
import {
  describeTaskEvent,
  DONE_LIMIT,
  projectTaskList,
  taskDetail,
} from "./board";
import {
  completeTask,
  createTask,
  getTask,
  moveTask,
  updateTask,
} from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
let status: Record<string, string>;

beforeAll(async () => {
  h = await openTestHub();
  const rows = (
    await h.raw.query<{ id: string; name: string }>(
      `select id, name from ${S}.task_statuses where project_id = $1`,
      [h.vit],
    )
  ).rows;
  status = Object.fromEntries(rows.map((r) => [r.name, r.id]));
});

afterAll(async () => {
  await h.db.close();
});

const asOwner = () => ctxFor(h, h.owner_actor, "ui");

async function novaTarefa(title: string, extra: object = {}) {
  return inTx(asOwner(), (t) =>
    createTask(t, { project: "VIT", title, ...extra }),
  );
}

async function hubError(promise: Promise<unknown>): Promise<HubError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HubError);
  return err as HubError;
}

describe("lista de tarefas do projeto", () => {
  it("traz status na ordem do projeto, abertas e concluídas, e o dia de hoje", async () => {
    const aberta = await novaTarefa("Lista: aberta", {
      workstream_id: h.vitWorkstream,
      priority: "high",
    });
    const feita = await novaTarefa("Lista: feita");
    await inTx(asOwner(), (t) =>
      completeTask(t, feita.code, { evidence: "Teste da lista." }),
    );

    const list = await inTx(asOwner(), (t) => projectTaskList(t, "VIT"));
    expect(list.statuses.map((s) => s.name)).toEqual([
      "A fazer",
      "Em andamento",
      "Em revisão",
      "Bloqueada",
      "Concluída",
    ]);
    expect(list.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(list.workstream).toBeNull();
    const codes = list.tasks.map((t) => t.code);
    expect(codes).toContain(aberta.code);
    expect(codes).toContain(feita.code);
    expect(list.doneTotal).toBeGreaterThanOrEqual(1);
    expect(list.workstreams.map((w) => w.title)).toContain(
      "Fluxo de atendimento",
    );
    expect(list.assignees.some((a) => a.type === "user")).toBe(true);
    // Agente pausado aparece marcado; nenhum revogado entra.
    expect(list.assignees.find((a) => a.id === h.agents.pausado)?.paused).toBe(
      true,
    );
  });

  it("filtra por frente, por tarefas sem frente e ignora frente desconhecida", async () => {
    const comFrente = await novaTarefa("Filtro: com frente", {
      workstream_id: h.vitWorkstream,
    });
    const semFrente = await novaTarefa("Filtro: sem frente");

    const daFrente = await inTx(asOwner(), (t) =>
      projectTaskList(t, "VIT", { workstream: h.vitWorkstream }),
    );
    expect(daFrente.workstream).toBe(h.vitWorkstream);
    expect(daFrente.tasks.map((t) => t.code)).toContain(comFrente.code);
    expect(daFrente.tasks.map((t) => t.code)).not.toContain(semFrente.code);

    const nenhuma = await inTx(asOwner(), (t) =>
      projectTaskList(t, "VIT", { workstream: "none" }),
    );
    expect(nenhuma.tasks.map((t) => t.code)).toContain(semFrente.code);
    expect(nenhuma.tasks.every((t) => t.workstream === null)).toBe(true);

    const estranha = await inTx(asOwner(), (t) =>
      projectTaskList(t, "VIT", { workstream: "'; drop table x; --" }),
    );
    expect(estranha.workstream).toBeNull();
    expect(estranha.tasks.map((t) => t.code)).toContain(semFrente.code);
  });

  it("filtra pelo departamento: só as frentes ativas dele no projeto (RF-23)", async () => {
    const [design, sistemas] = await inTx(asOwner(), async (t) => [
      await createWorkstream(t, {
        project: "VIT",
        title: "Telas do painel",
        department: "design",
      }),
      await createWorkstream(t, {
        project: "VIT",
        title: "Integração com a agenda",
        department: "sistemas",
      }),
    ]);
    const deDesign = await novaTarefa("Departamento: design", {
      workstream_id: design.id,
    });
    const deSistemas = await novaTarefa("Departamento: sistemas", {
      workstream_id: sistemas.id,
    });
    const solta = await novaTarefa("Departamento: sem frente");

    const lista = await inTx(asOwner(), (t) =>
      projectTaskList(t, "VIT", { department: "design" }),
    );
    expect(lista.department).toBe("design");
    // Na ordem do workspace: Sistemas vem antes de Design.
    expect(lista.departments.map((d) => d.slug)).toEqual([
      "sistemas",
      "design",
    ]);
    const codes = lista.tasks.map((t) => t.code);
    expect(codes).toContain(deDesign.code);
    expect(codes).not.toContain(deSistemas.code);
    expect(codes).not.toContain(solta.code);

    // Departamento que existe e não tem frente aqui: a lista vem vazia, não inteira.
    const dados = await inTx(asOwner(), (t) =>
      projectTaskList(t, "VIT", { department: "dados" }),
    );
    expect(dados.department).toBe("dados");
    expect(dados.tasks).toEqual([]);
    expect(dados.openTotal).toBe(0);
    expect(dados.departments.map((d) => d.slug)).toEqual([
      "sistemas",
      "design",
      "dados",
    ]);

    // Desconhecido ou fora do formato: sem filtro.
    for (const department of ["nao-existe", "'; drop table x; --"]) {
      const all = await inTx(asOwner(), (t) =>
        projectTaskList(t, "VIT", { department }),
      );
      expect(all.department).toBeNull();
      expect(all.tasks.map((t) => t.code)).toContain(solta.code);
    }

    // Frente arquivada sai da visão do departamento (e o departamento, da escolha).
    await inTx(asOwner(), async (t) => {
      await completeTask(t, deSistemas.code, { evidence: "Teste." });
      await archiveWorkstream(t, sistemas.id);
    });
    const semSistemas = await inTx(asOwner(), (t) => projectTaskList(t, "VIT"));
    expect(semSistemas.departments.map((d) => d.slug)).toEqual(["design"]);
  });

  it("limita as concluídas às mais recentes e informa o total", () => {
    expect(DONE_LIMIT).toBe(50);
  });

  it("projeto inexistente dá 404", async () => {
    const err = await hubError(
      inTx(asOwner(), (t) => projectTaskList(t, "NAOHA")),
    );
    expect(err.status).toBe(404);
  });
});

describe("mudar status pela tela", () => {
  it("anda pelos status comuns e confere a versão lida", async () => {
    const task = await novaTarefa("Status: comum");
    const doing = await inTx(asOwner(), (t) =>
      moveTask(
        t,
        task.code,
        { status_id: status["Em andamento"] },
        task.version,
      ),
    );
    expect(doing.status.name).toBe("Em andamento");
    expect(doing.assignee).toBeNull();

    const stale = await hubError(
      inTx(asOwner(), (t) =>
        moveTask(
          t,
          task.code,
          { status_id: status["Em revisão"] },
          task.version,
        ),
      ),
    );
    expect(stale.status).toBe(412);

    const review = await inTx(asOwner(), (t) =>
      moveTask(
        t,
        task.code,
        { status_id: status["Em revisão"] },
        doing.version,
      ),
    );
    expect(review.status.name).toBe("Em revisão");
  });

  it("bloquear exige motivo e sair do bloqueio apaga o motivo", async () => {
    const task = await novaTarefa("Status: bloqueio");
    const semMotivo = await hubError(
      inTx(asOwner(), (t) =>
        moveTask(t, task.code, { status_id: status["Bloqueada"], reason: " " }),
      ),
    );
    expect(semMotivo.status).toBe(422);

    const blocked = await inTx(asOwner(), (t) =>
      moveTask(t, task.code, {
        status_id: status["Bloqueada"],
        reason: "Aguarda o acesso da agenda.",
      }),
    );
    expect(blocked.status.category).toBe("blocked");
    expect(blocked.blocked_reason).toBe("Aguarda o acesso da agenda.");

    const back = await inTx(asOwner(), (t) =>
      moveTask(t, task.code, { status_id: status["Em andamento"] }),
    );
    expect(back.status.name).toBe("Em andamento");
    expect(back.blocked_reason).toBeNull();
  });

  it("concluir exige evidência; concluída volta reaberta, inclusive para bloqueio", async () => {
    const task = await novaTarefa("Status: conclusão");
    const semEvidencia = await hubError(
      inTx(asOwner(), (t) =>
        moveTask(t, task.code, { status_id: status["Concluída"] }),
      ),
    );
    expect(semEvidencia.status).toBe(422);

    const done = await inTx(asOwner(), (t) =>
      moveTask(t, task.code, {
        status_id: status["Concluída"],
        evidence: "  https://exemplo.com/entrega  ",
      }),
    );
    expect(done.status.category).toBe("done");
    expect(done.done_evidence).toBe("https://exemplo.com/entrega");
    expect(done.completed_by?.name).toBe("Fábio Almeida");

    const review = await inTx(asOwner(), (t) =>
      moveTask(t, task.code, { status_id: status["Em revisão"] }),
    );
    expect(review.status.name).toBe("Em revisão");
    expect(review.done_evidence).toBeNull();

    await inTx(asOwner(), (t) =>
      moveTask(t, task.code, {
        status_id: status["Concluída"],
        evidence: "Segunda entrega.",
      }),
    );
    const blocked = await inTx(asOwner(), (t) =>
      moveTask(t, task.code, {
        status_id: status["Bloqueada"],
        reason: "O cliente pediu ajuste.",
      }),
    );
    expect(blocked.status.category).toBe("blocked");
    expect(blocked.completed_at).toBeNull();
  });

  it("recusa status de outro projeto ou inválido, e não mexe no mesmo status", async () => {
    const task = await novaTarefa("Status: recusas");
    const hubTodo = (
      await h.raw.query<{ id: string }>(
        `select id from ${S}.task_statuses where project_id = $1 and category = 'todo'`,
        [h.hub],
      )
    ).rows[0].id;
    const outro = await hubError(
      inTx(asOwner(), (t) => moveTask(t, task.code, { status_id: hubTodo })),
    );
    expect(outro.status).toBe(422);
    const invalido = await hubError(
      inTx(asOwner(), (t) => moveTask(t, task.code, { status_id: "abc" })),
    );
    expect(invalido.status).toBe(400);

    const same = await inTx(asOwner(), (t) =>
      moveTask(t, task.code, { status_id: status["A fazer"] }, task.version),
    );
    expect(same.version).toBe(task.version);
  });
});

describe("painel da tarefa", () => {
  it("traz comentários, subtarefas e o histórico em PT-BR", async () => {
    const pai = await novaTarefa("Painel: pai");
    const filha = await novaTarefa("Painel: subtarefa", { parent: pai.code });
    await inTx(asOwner(), (t) =>
      createComment(t, { task: pai.code }, { body_md: "Primeiro comentário." }),
    );
    const atual = await inTx(asOwner(), (t) => getTask(t, pai.code));
    await inTx(asOwner(), (t) =>
      updateTask(
        t,
        pai.code,
        { priority: "urgent", due_date: "2026-11-20" },
        atual.version,
      ),
    );
    await inTx(asOwner(), (t) =>
      completeTask(t, pai.code, { evidence: "Entregue no repositório." }),
    );

    const detail = await inTx(asOwner(), (t) => taskDetail(t, pai.code));
    expect(detail.task.code).toBe(pai.code);
    expect(detail.subtasks.map((s) => s.code)).toEqual([filha.code]);
    expect(detail.comments.map((c) => c.body_md)).toEqual([
      "Primeiro comentário.",
    ]);
    expect(detail.statuses).toHaveLength(5);
    // Sugestões de dependência: as outras tarefas do projeto, nunca a própria.
    expect(detail.peers.map((p) => p.code)).toContain(filha.code);
    expect(detail.peers.map((p) => p.code)).not.toContain(pai.code);
    const texts = detail.history.map((e) => e.text);
    expect(texts[0]).toBe("concluiu a tarefa");
    expect(detail.history[0].detail).toBe("Entregue no repositório.");
    expect(detail.history[0].actor?.name).toBe("Fábio Almeida");
    expect(texts).toContain(
      "mudou a prioridade para Urgente e mudou o prazo para 20/11/2026",
    );
    expect(texts).toContain("comentou");
    expect(texts[texts.length - 1]).toBe("criou a tarefa");
  });

  it("tarefa inexistente dá 404", async () => {
    const err = await hubError(
      inTx(asOwner(), (t) => taskDetail(t, "VIT-999999")),
    );
    expect(err.status).toBe(404);
  });
});

describe("histórico em PT-BR", () => {
  it("descreve mudanças de status, campos e ações", () => {
    expect(
      describeTaskEvent("task.updated", {
        status: "Em andamento",
        blocked_reason: null,
      }).text,
    ).toBe("mudou o status para Em andamento");
    expect(
      describeTaskEvent("task.updated", {
        title: "Novo",
        assignee: null,
        workstream: "id",
      }).text,
    ).toBe("mudou o título, tirou o responsável e mudou a frente");
    expect(describeTaskEvent("task.updated", { due_date: null }).text).toBe(
      "tirou o prazo",
    );
    expect(
      describeTaskEvent("concierge.confirmed", { voice: true, edited: false })
        .text,
    ).toBe("confirmou o pedido feito por voz ao Concierge");
    expect(
      describeTaskEvent("concierge.confirmed", { voice: false }).text,
    ).toBe("confirmou o pedido feito ao Concierge");
    expect(describeTaskEvent("task.updated", {}).text).toBe(
      "atualizou a tarefa",
    );
    expect(
      describeTaskEvent("task.blocked", { blocked_reason: "Falta acesso." }),
    ).toEqual({ text: "bloqueou a tarefa", detail: "Falta acesso." });
    expect(describeTaskEvent("task.reopened", { reason: null })).toEqual({
      text: "reabriu a tarefa",
      detail: null,
    });
    expect(describeTaskEvent("outra.coisa", null).text).toBe("outra.coisa");
  });
});

describe("filtros combináveis da lista", () => {
  it("responsável, prioridade, prazo e busca, juntos ou separados", async () => {
    const make = (title: string, extra: Record<string, unknown>) =>
      inTx(asOwner(), (t) =>
        createTask(t, { project: "VIT", title, ...extra } as never),
      );
    const mine = await make("Filtro: minha urgente", {
      priority: "urgent",
      assignee: "me",
      due_date: "2020-01-10",
    });
    const nobody = await make("Filtro: sem dono baixa", { priority: "low" });
    const codes = async (filter: Parameters<typeof projectTaskList>[2]) =>
      (await inTx(asOwner(), (t) => projectTaskList(t, "VIT", filter))).tasks
        .map((t) => t.code)
        .filter((c) => c === mine.code || c === nobody.code);

    expect(await codes({ assignee: "me" })).toEqual([mine.code]);
    expect(await codes({ assignee: "none", priorities: ["low"] })).toEqual([
      nobody.code,
    ]);
    expect(await codes({ due: "late" })).toEqual([mine.code]);
    expect(await codes({ due: "none", search: "sem dono" })).toEqual([
      nobody.code,
    ]);
    expect(await codes({ search: mine.code.toLowerCase() })).toEqual([
      mine.code,
    ]);
    expect(await codes({ search: "100%_" })).toEqual([]);
  });
});
