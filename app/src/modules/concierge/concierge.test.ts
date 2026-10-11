import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import type { ModelFactory } from "@/lib/llm";
import { createAgent } from "@/modules/agents/service";
import { requestApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import { setAgentModel } from "@/modules/llm/agent-model";
import { createCredential } from "@/modules/llm/credentials";
import { blockTask, createTask, getTask } from "@/modules/tasks/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";
import type { ConciergeIntent } from "./intent";
import { executeConcierge, interpretRequest, NO_CONCIERGE } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
let member: UserActor;
let conciergeId: string;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asMember = () => ctxFor(h, member, "ui");

beforeAll(async () => {
  process.env.HUB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  h = await openTestHub();
  // Caio: pessoa da equipe que participa só do VIT.
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('caio@exemplo.com', 'Caio Prado') returning id`,
    )
  ).rows[0];
  await h.raw.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'member')`,
    [h.ws, profile.id],
  );
  await h.raw.query(
    `insert into ${S}.project_members (workspace_id, project_id, profile_id, role) values ($1, $2, $3, 'member')`,
    [h.ws, h.vit, profile.id],
  );
  member = {
    type: "user",
    id: profile.id,
    scope: "internal",
    role: "member",
    workspaceId: h.ws,
    name: "Caio Prado",
  };
});

afterAll(async () => {
  await h.db.close();
});

const full = (intent: Partial<ConciergeIntent>): ConciergeIntent => ({
  kind: "unknown",
  project: null,
  task: null,
  title: null,
  description: null,
  due_date: null,
  priority: null,
  assignee: null,
  status: null,
  reason: null,
  comment: null,
  approval: null,
  question: null,
  screen: null,
  note: null,
  ...intent,
});

/** IA simulada: devolve a intenção pedida e guarda a mensagem que recebeu. */
function answering(
  intent: Partial<ConciergeIntent>,
  seen: string[] = [],
): ModelFactory {
  return () =>
    new MockLanguageModelV4({
      doGenerate: async (options) => {
        const user = options.prompt.filter((m) => m.role === "user").at(-1);
        seen.push(
          (user?.content ?? [])
            .map((p) => (p.type === "text" ? p.text : ""))
            .join(""),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(full(intent)) }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: {
              total: 300,
              noCache: 300,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 60, text: 60, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
}

const ask = (
  text: string,
  intent: Partial<ConciergeIntent>,
  options: { as?: () => ReturnType<typeof asOwner>; path?: string } = {},
  seen: string[] = [],
) =>
  interpretRequest(
    (options.as ?? asOwner)(),
    { text, path: options.path ?? "/" },
    { modelFor: answering(intent, seen) },
  );

async function proposal(
  text: string,
  intent: Partial<ConciergeIntent>,
  options: { as?: () => ReturnType<typeof asOwner>; path?: string } = {},
  seen: string[] = [],
) {
  const result = await ask(text, intent, options, seen);
  if (!result.ok) throw new Error(result.message);
  return result.proposal;
}

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

describe("Concierge (CO-10)", () => {
  it("falha fechada: sem agente CO-10 ou sem modelo de IA, não chama a IA", async () => {
    const seen: string[] = [];
    expect(
      await ask("cria uma tarefa", { kind: "create_task" }, {}, seen),
    ).toEqual({ ok: false, message: NO_CONCIERGE });
    conciergeId = (
      await inTx(asOwner(), (t) =>
        createAgent(t, {
          name: "Concierge",
          kind: "internal",
          roles: ["CO-10"],
        }),
      )
    ).id;
    const noModel = await ask(
      "cria uma tarefa",
      { kind: "create_task" },
      {},
      seen,
    );
    expect(noModel).toMatchObject({ ok: false });
    expect(!noModel.ok && noModel.message).toContain("modelo de IA");
    expect(seen).toEqual([]);

    // Liga a IA do Concierge (chave de mentira; o modelo é sempre o simulado).
    const credential = await inTx(asOwner(), (t) =>
      createCredential(t, {
        provider: "anthropic",
        label: "Chave de teste",
        key: "sk-ant-teste-fake-000000000000000000000000",
      }),
    );
    await inTx(asOwner(), (t) =>
      setAgentModel(t, conciergeId, {
        provider: "anthropic",
        model: "modelo-de-teste",
        credential_id: credential.id,
        price_in: 3,
        price_out: 15,
        budget_usd_month: 5,
      }),
    );
  });

  it("criar tarefa: a prévia confere projeto, pessoa e data, e nada é gravado antes de confirmar", async () => {
    const tasks = () => count(h, `select count(*)::int as n from ${S}.tasks`);
    const before = await tasks();
    const seen: string[] = [];
    const preview = await proposal(
      "cria uma tarefa de revisar o contrato no atendimento com ia para março, urgente, comigo",
      {
        kind: "create_task",
        project: "Atendimento com IA",
        title: "Revisar o contrato",
        due_date: "2099-03-10",
        priority: "high",
        assignee: "eu",
      },
      {},
      seen,
    );
    expect(preview).toEqual({
      kind: "create_task",
      draft: {
        project: "VIT",
        title: "Revisar o contrato",
        description: "",
        due_date: "2099-03-10",
        priority: "high",
        assignee: "me",
      },
      projects: expect.arrayContaining([
        { value: "VIT", label: "VIT · Atendimento com IA" },
      ]),
      team: expect.arrayContaining([
        { value: "me", label: "Eu (Fábio Almeida)" },
      ]),
      notes: [],
    });
    expect(await tasks()).toBe(before);
    // A mensagem leva o dia, o alcance de quem pede e, por último, o pedido.
    expect(seen[0]).toMatch(/^HOJE: [a-zçáéíóúâêô-]+, \d{4}-\d{2}-\d{2}\n/);
    expect(seen[0]).toContain("- VIT · Atendimento com IA");
    expect(seen[0]).toContain("- Caio Prado · pessoa");
    expect(seen[0].split("\n").slice(-2)).toEqual([
      "PEDIDO:",
      "cria uma tarefa de revisar o contrato no atendimento com ia para março, urgente, comigo",
    ]);

    // O que não bate vira campo vazio, com aviso; sem projeto citado, vale o da tela.
    const loose = await proposal(
      "anota pra fazer",
      {
        kind: "create_task",
        title: "Ligar para a clínica",
        assignee: "Zé Ninguém",
        due_date: "2026-02-30",
      },
      { path: "/projetos/VIT/quadro" },
    );
    expect(loose).toMatchObject({
      kind: "create_task",
      draft: { project: "VIT", assignee: "", due_date: "" },
      notes: [
        "Não achei “Zé Ninguém” na equipe: escolha o responsável.",
        "O prazo entendido não é uma data válida: escolha no campo.",
      ],
    });
    const unknownProject = await proposal("cria no projeto xyz", {
      kind: "create_task",
      project: "XYZ",
      title: "Algo",
    });
    expect(unknownProject).toMatchObject({
      draft: { project: "" },
      notes: ["Não achei o projeto “XYZ”: escolha na lista."],
    });
  });

  it("o alcance é o de quem pede: a pessoa só vê os próprios projetos", async () => {
    const hubTask = await inTx(asOwner(), (t) =>
      createTask(t, { project: "HUB", title: "Tarefa interna do Hub" }),
    );
    const seen: string[] = [];
    const preview = await proposal(
      `comenta na ${hubTask.code}`,
      { kind: "comment", task: hubTask.code, comment: "Oi" },
      { as: asMember },
      seen,
    );
    expect(preview).toEqual({
      kind: "unknown",
      message: `Não achei a tarefa ${hubTask.code} no seu alcance.`,
    });
    expect(seen[0]).toContain("- VIT · Atendimento com IA");
    expect(seen[0]).not.toContain("- HUB ·");
  });

  it("mudar, comentar e abrir: a tarefa citada é conferida antes da prévia", async () => {
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Publicar a página" }),
    );
    const spoken = task.code.toLowerCase().replace("-", " ");
    const done = await proposal(`conclui a ${spoken}`, {
      kind: "update_task",
      task: spoken,
      status: "done",
      reason: "https://exemplo.com/pr/1",
    });
    expect(done).toMatchObject({
      kind: "update_task",
      task: { code: task.code, project_code: "VIT", version: task.version },
      changes: { due_date: null, priority: null, assignee: null, title: null },
      reason: "https://exemplo.com/pr/1",
      notes: [],
    });
    if (done.kind !== "update_task") throw new Error("tipo");
    const target = done.statuses.find((s) => s.id === done.changes.status_id);
    expect(target?.category).toBe("done");

    expect(
      await proposal("deixa a tarefa a fazer", {
        kind: "update_task",
        task: task.code,
        status: "todo",
      }),
    ).toEqual({
      kind: "unknown",
      message: `${task.code} já está em “${task.status.name}”.`,
    });
    expect(
      await proposal("comenta", {
        kind: "comment",
        task: task.code,
        comment: "Falei com o cliente hoje.",
      }),
    ).toMatchObject({ kind: "comment", body: "Falei com o cliente hoje." });
    expect(
      await proposal("abre o quadro do vit", {
        kind: "navigate",
        screen: "quadro",
        project: "vit",
      }),
    ).toEqual({
      kind: "navigate",
      label: "Quadro de VIT · Atendimento com IA",
      href: "/projetos/VIT/quadro",
    });
    expect(
      await proposal("abre a tarefa", { kind: "navigate", task: task.code }),
    ).toEqual({
      kind: "navigate",
      label: `${task.code} · Publicar a página`,
      href: `/projetos/VIT/lista?tarefa=${task.code}`,
    });
  });

  it("aprovação: o Concierge aponta o pedido, e quem decide é a pessoa", async () => {
    const kratos = {
      ...(await agentActor(h, h.keys.kratos)),
      actingRole: "GP-01",
    };
    const approval = await inTx(ctxFor(h, kratos, "mcp"), (t) =>
      requestApproval(t, {
        type: "replan",
        project: "VIT",
        title: "Mover o lançamento em uma semana",
        payload: { milestones: [{ code: "M1", due_date: "2026-12-01" }] },
      }),
    );
    const seen: string[] = [];
    expect(
      await proposal(
        "aprova a mudança do lançamento",
        { kind: "approval", approval: 1 },
        {},
        seen,
      ),
    ).toEqual({ kind: "approval", approvalId: approval.id });
    expect(seen[0]).toContain(
      "1 · Replanejamento · Mover o lançamento em uma semana · VIT",
    );
    expect(
      await proposal("aprova o outro", { kind: "approval", approval: 9 }),
    ).toMatchObject({ kind: "unknown" });
    // Nada foi decidido.
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.approvals where id = $1 and status = 'pending'`,
        [approval.id],
      ),
    ).toBe(1);
  });

  it("perguntas são respondidas com os dados do Hub", async () => {
    const stuck = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Integrar a agenda" }),
    );
    await inTx(asOwner(), (t) =>
      blockTask(t, stuck.code, { reason: "Falta a credencial da clínica." }),
    );
    const blocked = await proposal("o que está travado no vit?", {
      kind: "question",
      question: "blocked",
      project: "VIT",
    });
    expect(blocked).toMatchObject({
      kind: "answer",
      title: "Bloqueadas em VIT",
      items: [
        {
          label: `${stuck.code} · Integrar a agenda`,
          hint: "Falta a credencial da clínica.",
          href: `/projetos/VIT/lista?tarefa=${stuck.code}`,
        },
      ],
      more: null,
    });
    expect(
      await proposal("o que está atrasado?", {
        kind: "question",
        question: "overdue",
      }),
    ).toMatchObject({
      kind: "answer",
      items: [],
      empty: "Nada atrasado.",
    });
    const status = await proposal("como está o vit?", {
      kind: "question",
      question: "project_status",
      project: "VIT",
    });
    expect(status).toMatchObject({ kind: "answer" });
    if (status.kind !== "answer") throw new Error("tipo");
    expect(status.items.map((i) => i.label)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Saúde: /),
        expect.stringMatching(/^Progresso: \d+%$/),
      ]),
    );
  });

  it("executa só o confirmado, em nome da pessoa, com o papel CO-10 no histórico", async () => {
    const created = await executeConcierge(
      asOwner(),
      {
        kind: "create_task",
        project: "VIT",
        title: "Ligar para a clínica",
        priority: "normal",
        due_date: "2099-05-01",
        assignee: "me",
      },
      { edited: true, voice: true, seconds: 12 },
    );
    expect(created).toMatchObject({
      project_code: "VIT",
      message: `${created.code} criada em VIT.`,
    });
    const task = await inTx(asOwner(), (t) => getTask(t, created.code));
    expect(task.assignee?.id).toBe(h.owner);
    const log = await h.raw.query<{
      action: string;
      actor_type: string;
      acting_role: string | null;
      source: string;
      after: Record<string, unknown>;
    }>(
      `select action, actor_type::text as actor_type, acting_role, source, after
         from ${S}.activity_log where entity_id = $1 order by id`,
      [task.id],
    );
    expect(log.rows.map((r) => r.action)).toEqual([
      "task.created",
      "concierge.confirmed",
    ]);
    for (const row of log.rows) {
      expect(row).toMatchObject({
        actor_type: "user",
        acting_role: "CO-10",
        source: "ui",
      });
    }
    expect(log.rows[1].after).toEqual({
      kind: "create_task",
      code: created.code,
      edited: true,
      voice: true,
      seconds: 12,
    });

    // Concluir exige evidência (a regra de sempre vale no Concierge).
    const doneStatus = (
      await h.raw.query<{ id: string }>(
        `select id from ${S}.task_statuses where project_id = $1 and category = 'done' limit 1`,
        [h.vit],
      )
    ).rows[0].id;
    expect(
      await status(
        executeConcierge(
          asOwner(),
          {
            kind: "update_task",
            task: created.code,
            version: task.version,
            status_id: doneStatus,
          },
          { edited: false, voice: false, seconds: null },
        ),
      ),
    ).toBe(422);
    const updated = await executeConcierge(
      asOwner(),
      {
        kind: "update_task",
        task: created.code,
        version: task.version,
        status_id: doneStatus,
        evidence: "Ligação feita, registrada na ata.",
        priority: "high",
      },
      { edited: false, voice: false, seconds: 5 },
    );
    expect(updated.message).toBe(`${created.code} atualizada (Concluída).`);
    const commented = await executeConcierge(
      asMember(),
      { kind: "comment", task: created.code, body_md: "Tudo certo por aqui." },
      { edited: false, voice: true, seconds: 8 },
    );
    expect(commented.message).toBe(`Comentário publicado em ${created.code}.`);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.comments
          where entity_id = $1 and acting_role = 'CO-10' and author_id = $2`,
        [task.id, member.id],
      ),
    ).toBe(1);

    // Os limites são os da pessoa: Caio não cria tarefa no HUB.
    expect(
      await status(
        executeConcierge(
          asMember(),
          {
            kind: "create_task",
            project: "HUB",
            title: "Fora do alcance",
            priority: "normal",
          },
          { edited: false, voice: false, seconds: null },
        ),
      ),
    ).toBeGreaterThanOrEqual(403);
  });
});
