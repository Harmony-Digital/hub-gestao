import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentActor, UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { shellData } from "@/modules/shell/service";
import {
  blockTask,
  completeTask,
  createTask,
  startTask,
} from "@/modules/tasks/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import {
  describeActivity,
  listProjectsBoard,
  projectOverview,
} from "./overview";

const S = "proj_hub_gestao";
let h: TestHub;
let kratos: AgentActor;

beforeAll(async () => {
  h = await openTestHub();
  kratos = await agentActor(h, h.keys.kratos);
  const asKratos = () => ctxFor(h, kratos, "mcp");
  // VIT: uma concluída, uma em andamento, uma bloqueada e uma a fazer.
  const done = await inTx(asKratos(), (t) =>
    createTask(t, { project: "VIT", title: "Mapear o atendimento" }),
  );
  await inTx(asKratos(), (t) => startTask(t, done.code));
  await inTx(asKratos(), (t) =>
    completeTask(t, done.code, { evidence: "Mapa no repositório." }),
  );
  const doing = await inTx(asKratos(), (t) =>
    createTask(t, {
      project: "VIT",
      title: "Escrever o fluxo",
      priority: "high",
    }),
  );
  await inTx(asKratos(), (t) => startTask(t, doing.code));
  const stuck = await inTx(asKratos(), (t) =>
    createTask(t, { project: "VIT", title: "Ligar a agenda" }),
  );
  await inTx(asKratos(), (t) =>
    blockTask(t, stuck.code, {
      reason: "Aguarda a credencial da API da agenda.",
    }),
  );
  await inTx(asKratos(), (t) =>
    createTask(t, { project: "VIT", title: "Revisar os textos" }),
  );
});

afterAll(async () => {
  await h.db.close();
});

const asOwner = () => ctxFor(h, h.owner_actor, "ui");

describe("visão do projeto em três camadas", () => {
  it("junta marcos, frentes, fila, bloqueios e atividade", async () => {
    const v = await inTx(asOwner(), (t) => projectOverview(t, "VIT"));
    expect(v.project.code).toBe("VIT");
    expect(v.milestones.map((m) => m.code)).toEqual(["M1"]);
    expect(v.workstreams.map((w) => w.title)).toEqual(["Fluxo de atendimento"]);

    // Fila: em andamento primeiro, sem as concluídas e sem as bloqueadas.
    expect(v.queue.map((t) => t.title)).toEqual([
      "Escrever o fluxo",
      "Revisar os textos",
    ]);
    expect(v.blocked).toHaveLength(1);
    expect(v.blocked[0]).toMatchObject({
      title: "Ligar a agenda",
      blocked_reason: "Aguarda a credencial da API da agenda.",
    });

    // Atividade: a mais recente primeiro, com o agente e o verbo em PT-BR.
    expect(v.activity[0].actor?.name).toBe("Kratos");
    const texts = v.activity.map((a) => a.text);
    expect(texts.some((t) => /^concluiu HUB-\d+$/.test(t))).toBe(true);
    expect(texts.some((t) => /^bloqueou HUB-\d+$/.test(t))).toBe(true);
  });

  it("projeto de que a pessoa não participa não abre", async () => {
    const member: UserActor = { ...h.owner_actor, role: "member" };
    await expect(
      inTx(ctxFor(h, member, "ui"), (t) => projectOverview(t, "VIT")),
    ).rejects.toBeInstanceOf(HubError);
    await expect(
      inTx(asOwner(), (t) => projectOverview(t, "NAO1")),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("verbos da atividade", () => {
    expect(describeActivity("task.completed", "HUB-1")).toBe("concluiu HUB-1");
    expect(describeActivity("comment.created", "HUB-1")).toBe("comentou em");
    expect(describeActivity("acao.nova", null)).toBe("acao.nova");
  });
});

describe("tela Projetos", () => {
  it("traz o próximo marco e o motivo da saúde", async () => {
    await h.raw.query(
      `update ${S}.projects set health = 'attention',
              health_reason = '{"reasons": ["12% das tarefas abertas estão bloqueadas."]}'::jsonb
        where code = 'VIT'`,
    );
    await h.raw.query(
      `update ${S}.milestones set due_date = current_date - 2 where code = 'M1'`,
    );
    const rows = await inTx(asOwner(), (t) => listProjectsBoard(t));
    const vit = rows.find((r) => r.code === "VIT")!;
    expect(vit.health).toBe("attention");
    expect(vit.health_reasons).toEqual([
      "12% das tarefas abertas estão bloqueadas.",
    ]);
    expect(vit.next_milestone).toMatchObject({ code: "M1", late: true });
    const hub = rows.find((r) => r.code === "HUB")!;
    expect(hub.next_milestone).toBeNull();
  });
});

describe("barra lateral", () => {
  it("o dono vê as decisões pendentes, os projetos em destaque e os agentes ativos", async () => {
    await h.raw.query(
      `insert into ${S}.approvals (workspace_id, project_id, type, title, payload, requested_by_type, requested_by_id)
       select $1, p.id, 'import_review', 'Revisar a importação', '{}'::jsonb, 'agent', $2
         from ${S}.projects p where p.code = 'VIT'`,
      [h.ws, h.agents.kratos],
    );
    const data = await inTx(asOwner(), (t) => shellData(t));
    expect(data.pendingDecisions).toBe(1);
    expect(data.featured[0]).toMatchObject({
      code: "VIT",
      health: "attention",
    });
    expect(data.agentsActive24h).toBe(1);
  });

  it("quem não decide não vê contagem de decisões", async () => {
    const admin: UserActor = { ...h.owner_actor, role: "admin" };
    const data = await inTx(ctxFor(h, admin, "ui"), (t) => shellData(t));
    expect(data.pendingDecisions).toBe(0);
  });
});
