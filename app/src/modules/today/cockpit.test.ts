import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentActor, UserActor } from "@/lib/db/actor";
import { requestApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import {
  blockTask,
  completeTask,
  createTask,
  startTask,
} from "@/modules/tasks/service";
import { refreshAllHealth } from "@/modules/health/service";
import { systemActor } from "@/modules/jobs/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { cockpit } from "./cockpit";

const S = "proj_hub_gestao";
let h: TestHub;
let kratos: AgentActor;
let member: UserActor;
let doneCode: string;
let stuckCode: string;

beforeAll(async () => {
  h = await openTestHub();
  kratos = { ...(await agentActor(h, h.keys.kratos)), actingRole: "GP-01" };
  const asKratos = () => ctxFor(h, kratos, "mcp");

  const done = await inTx(asKratos(), (t) =>
    createTask(t, { project: "VIT", title: "Painel: concluída hoje" }),
  );
  await inTx(asKratos(), (t) => startTask(t, done.code));
  await inTx(asKratos(), (t) =>
    completeTask(t, done.code, { evidence: "Teste do painel." }),
  );
  doneCode = done.code;
  const stuck = await inTx(asKratos(), (t) =>
    createTask(t, { project: "VIT", title: "Painel: bloqueada" }),
  );
  await inTx(asKratos(), (t) =>
    blockTask(t, stuck.code, { reason: "Falta o acesso da clínica." }),
  );
  stuckCode = stuck.code;
  await inTx(asKratos(), (t) =>
    requestApproval(t, {
      type: "client_visibility",
      project: "VIT",
      workstream_id: h.vitWorkstream,
      title: "Mostrar o fluxo de atendimento ao cliente",
      payload: { title_client: "Atendimento no WhatsApp" },
    }),
  );

  // Pessoa da equipe sem participar de nenhum projeto.
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('equipe@exemplo.com', 'Pessoa da Equipe') returning id`,
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
    name: "Pessoa da Equipe",
  };
});

afterAll(async () => {
  await h.db.close();
});

describe("painel Hoje", () => {
  it("o dono vê decisões, bloqueios, projetos e o que os agentes fizeram", async () => {
    const data = await inTx(ctxFor(h, h.owner_actor, "ui"), (t) => cockpit(t));
    expect(data.canDecide).toBe(true);
    expect(data.pending_approvals.map((a) => a.title)).toContain(
      "Mostrar o fluxo de atendimento ao cliente",
    );
    expect(data.blocked.map((b) => b.code)).toContain(stuckCode);
    expect(data.doneByAgentsToday).toBe(1);
    expect(data.projects.map((p) => p.code)).toEqual(
      expect.arrayContaining(["HUB", "VIT"]),
    );

    const completed = data.agentEvents.find((e) => e.taskCode === doneCode);
    expect(completed).toMatchObject({
      agent: "Kratos",
      role: "GP-01",
      projectCode: "VIT",
    });
    expect(data.agentEvents.map((e) => e.text)).toEqual(
      expect.arrayContaining([
        `concluiu ${doneCode}`,
        `bloqueou ${stuckCode}`,
        "pediu uma aprovação",
      ]),
    );
    // Mais recente primeiro.
    expect(data.agentEvents[0].text).toBe("pediu uma aprovação");
  });

  it("quem não participa do projeto não vê nada dele nem decide", async () => {
    const data = await inTx(ctxFor(h, member, "ui"), (t) => cockpit(t));
    expect(data.canDecide).toBe(false);
    expect(data.pending_approvals).toEqual([]);
    expect(data.blocked).toEqual([]);
    expect(data.projects).toEqual([]);
    expect(data.agentEvents).toEqual([]);
    expect(data.doneByAgentsToday).toBe(0);
  });
});

describe("riscos no Hoje (RF-24)", () => {
  it("cada risco vem com a ação sugerida e o link para resolver", async () => {
    // No VIT, 1 de 2 tarefas abertas está bloqueada (acima de 25%): em risco.
    await inTx(ctxFor(h, systemActor(h.ws), "system"), (t) =>
      refreshAllHealth(t, new Date()),
    );
    const data = await inTx(ctxFor(h, h.owner_actor, "ui"), (t) => cockpit(t));
    const vit = data.projects.find((p) => p.code === "VIT");
    expect(vit?.health).toBe("at_risk");
    expect(vit?.risks).toContainEqual({
      text: expect.stringMatching(/das tarefas abertas estão bloqueadas/),
      action: {
        label:
          "Abra as bloqueadas no Quadro e cobre de quem destrava a próxima ação.",
        href: "/projetos/VIT/quadro",
      },
    });
    expect(vit?.reasons).toEqual(vit?.risks.map((r) => r.text));
  });
});
