import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentActor, UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { decideApproval, requestApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import {
  createMilestone,
  requestMilestoneAcceptance,
  type CreateMilestoneInput,
} from "@/modules/milestones/admin";
import { milestonesOfProject } from "@/modules/milestones/service";
import { getProject, listProjects } from "@/modules/projects/service";
import { completeTask, createTask } from "@/modules/tasks/service";
import {
  createWorkstream,
  setWorkstreamVisibility,
  updateWorkstream,
} from "@/modules/workstreams/service";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";
import {
  archiveClient,
  archivedClients,
  archivedInProject,
  archivedProjects,
  archiveMilestone,
  archiveProject,
  archiveWorkstream,
  restoreClient,
  restoreMilestone,
  restoreProject,
  restoreWorkstream,
} from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
let member: UserActor;
let kratos: AgentActor;
let todos: AgentActor;

const asOwner = () => ctxFor(h, h.owner_actor, "ui");

function milestone(
  over: Partial<CreateMilestoneInput> = {},
): CreateMilestoneInput {
  return {
    title: "Relatórios semanais",
    title_client: "Relatórios do atendimento",
    description_client: null,
    due_date: "2026-12-10",
    status: "planned",
    visibility: "client",
    acceptance_criteria: [],
    ...over,
  };
}

async function hubError(promise: Promise<unknown>): Promise<HubError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HubError);
  return err as HubError;
}

const logged = (action: string, id: string) =>
  count(
    h,
    `select count(*)::int as n from ${S}.activity_log where action = $1 and entity_id = $2`,
    [action, id],
  );

beforeAll(async () => {
  h = await openTestHub();
  kratos = await agentActor(h, h.keys.kratos);
  todos = await agentActor(h, h.keys.todos);
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('equipe3@exemplo.com', 'Equipe Três') returning id`,
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
    name: "Equipe Três",
  };
});

afterAll(async () => {
  await h.db.close();
});

describe("arquivar marco", () => {
  it("sai da Visão geral, fica nos arquivados e volta ao restaurar", async () => {
    const m = await inTx(asOwner(), (t) =>
      createMilestone(t, "VIT", milestone()),
    );
    expect(await inTx(asOwner(), (t) => archiveMilestone(t, m.id))).toEqual({
      code: m.code,
    });
    const after = await inTx(asOwner(), async (t) => ({
      active: await milestonesOfProject(t, h.vit),
      archived: await archivedInProject(t, h.vit),
    }));
    expect(after.active.map((x) => x.code)).not.toContain(m.code);
    expect(after.archived.milestones.map((x) => x.code)).toContain(m.code);
    expect(await logged("milestone.archived", m.id)).toBe(1);
    expect(
      (await hubError(inTx(asOwner(), (t) => archiveMilestone(t, m.id))))
        .status,
    ).toBe(409);

    await inTx(asOwner(), (t) => restoreMilestone(t, m.id));
    const back = await inTx(asOwner(), (t) => milestonesOfProject(t, h.vit));
    expect(back.map((x) => x.code)).toContain(m.code);
    expect(await logged("milestone.restored", m.id)).toBe(1);
  });

  it("com frente ligada, aceite pendente ou já aceito, não arquiva", async () => {
    const linked = await hubError(
      inTx(asOwner(), (t) => archiveMilestone(t, h.vitMilestone)),
    );
    expect(linked.status).toBe(422);
    expect(linked.detail).toMatch(/frentes ligadas/);

    const m = await inTx(asOwner(), (t) =>
      createMilestone(t, "VIT", milestone({ title: "Lançamento" })),
    );
    const approval = await inTx(asOwner(), (t) =>
      requestMilestoneAcceptance(t, m.id),
    );
    expect(
      (await hubError(inTx(asOwner(), (t) => archiveMilestone(t, m.id))))
        .status,
    ).toBe(409);
    await inTx(asOwner(), (t) =>
      decideApproval(t, approval.id, { decision: "approved" }),
    );
    const accepted = await hubError(
      inTx(asOwner(), (t) => archiveMilestone(t, m.id)),
    );
    expect(accepted.status).toBe(422);
    expect(accepted.detail).toMatch(/aceito/);
  });

  it("equipe comum e agentes não arquivam marco", async () => {
    const m = await inTx(asOwner(), (t) =>
      createMilestone(t, "VIT", milestone({ title: "Painel" })),
    );
    expect(
      (
        await hubError(
          inTx(ctxFor(h, member, "ui"), (t) => archiveMilestone(t, m.id)),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await hubError(
          inTx(ctxFor(h, kratos, "mcp"), (t) => archiveMilestone(t, m.id)),
        )
      ).status,
    ).toBe(403);
  });
});

describe("arquivar frente", () => {
  it("com tarefa aberta não arquiva; concluída, arquiva e o marco recalcula", async () => {
    const w = await inTx(asOwner(), (t) =>
      createWorkstream(t, {
        project: "VIT",
        title: "Relatórios automáticos",
        milestone: "M1",
      }),
    );
    const task = await inTx(asOwner(), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Gerar o relatório da semana",
        workstream_id: w.id,
      }),
    );
    const open = await hubError(
      inTx(asOwner(), (t) => archiveWorkstream(t, w.id)),
    );
    expect(open.status).toBe(422);
    expect(open.detail).toMatch(/1 tarefa aberta/);

    await inTx(asOwner(), (t) =>
      completeTask(t, task.code, { evidence: "Relatório enviado." }),
    );
    const m1 = () =>
      count(h, `select task_count as n from ${S}.milestones where id = $1`, [
        h.vitMilestone,
      ]);
    expect(await m1()).toBe(1);
    await inTx(asOwner(), (t) => archiveWorkstream(t, w.id));
    expect(await m1()).toBe(0);
    expect(await logged("workstream.archived", w.id)).toBe(1);

    await inTx(asOwner(), (t) => restoreWorkstream(t, w.id));
    expect(await m1()).toBe(1);
  });

  it("frente que o cliente vê: só quem decide arquiva; agente nunca", async () => {
    await inTx(asOwner(), (t) =>
      setWorkstreamVisibility(t, h.vitWorkstream, {
        visibility: "client",
        title_client: "Atendimento no WhatsApp",
        description_client: null,
      }),
    );
    expect(
      (
        await hubError(
          inTx(ctxFor(h, member, "ui"), (t) =>
            archiveWorkstream(t, h.vitWorkstream),
          ),
        )
      ).status,
    ).toBe(403);
    const agent = await hubError(
      inTx(ctxFor(h, kratos, "mcp"), (t) =>
        archiveWorkstream(t, h.vitWorkstream),
      ),
    );
    expect(agent.status).toBe(403);
    expect(agent.extra).toMatchObject({ human_only: true });
  });

  it("restaurar pede o marco ativo", async () => {
    const m = await inTx(asOwner(), (t) =>
      createMilestone(t, "VIT", milestone({ title: "Treinamento" })),
    );
    const w = await inTx(asOwner(), (t) =>
      createWorkstream(t, {
        project: "VIT",
        title: "Material de treinamento",
        milestone: m.code,
      }),
    );
    await inTx(asOwner(), async (t) => {
      await archiveWorkstream(t, w.id);
      await archiveMilestone(t, m.id);
    });
    const blocked = await hubError(
      inTx(asOwner(), (t) => restoreWorkstream(t, w.id)),
    );
    expect(blocked.status).toBe(422);
    expect(blocked.detail).toMatch(new RegExp(`${m.code} desta frente`));
    await inTx(asOwner(), async (t) => {
      await restoreMilestone(t, m.id);
      await restoreWorkstream(t, w.id);
    });
    const archived = await inTx(asOwner(), (t) => archivedInProject(t, h.vit));
    expect(archived.workstreams.map((x) => x.id)).not.toContain(w.id);
  });
});

describe("arquivar projeto e cliente", () => {
  let client: string;
  let workstream: string;

  beforeAll(async () => {
    client = (
      await h.raw.query<{ id: string }>(
        `insert into ${S}.clients (workspace_id, slug, name) values ($1, 'otica-teste', 'Ótica Teste') returning id`,
        [h.ws],
      )
    ).rows[0].id;
    const project = (
      await h.raw.query<{ id: string }>(
        `insert into ${S}.projects (workspace_id, client_id, code, name, status) values ($1, $2, 'ARQ', 'Projeto para arquivar', 'active') returning id`,
        [h.ws, client],
      )
    ).rows[0].id;
    await h.raw.query(
      `insert into ${S}.task_statuses (workspace_id, project_id, name, color, category, sort_order, is_default)
       select $1, $2, s ->> 'name', s ->> 'color', (s ->> 'category')::${S}.status_category,
              (s ->> 'sort_order')::int, coalesce((s ->> 'is_default')::boolean, false)
         from ${S}.workspaces w, jsonb_array_elements(w.settings -> 'default_task_statuses') s
        where w.id = $1`,
      [h.ws, project],
    );
    workstream = (
      await inTx(asOwner(), (t) =>
        createWorkstream(t, { project: "ARQ", title: "Vitrine" }),
      )
    ).id;
  });

  it("pedido esperando decisão trava; arquivado, o projeto vira só leitura", async () => {
    const approval = await inTx(asOwner(), (t) =>
      requestApproval(t, {
        type: "custom",
        project: "ARQ",
        title: "Combinar a vitrine",
      }),
    );
    const waiting = await hubError(
      inTx(asOwner(), (t) => archiveProject(t, "ARQ")),
    );
    expect(waiting.status).toBe(422);
    expect(waiting.detail).toMatch(/1 pedido esperando/);
    await inTx(asOwner(), (t) =>
      decideApproval(t, approval.id, { decision: "rejected" }),
    );

    await inTx(asOwner(), (t) => archiveProject(t, "ARQ"));
    const view = await inTx(asOwner(), async (t) => ({
      list: (await listProjects(t)).items.map((p) => p.code),
      archived: (await archivedProjects(t)).map((p) => p.code),
      detail: await getProject(t, "ARQ"),
    }));
    expect(view.list).not.toContain("ARQ");
    expect(view.archived).toContain("ARQ");
    expect(view.detail.status).toBe("archived");

    // Pessoa, agente, por código ou por id: nada escreve em projeto arquivado.
    const task = await hubError(
      inTx(asOwner(), (t) =>
        createTask(t, { project: "ARQ", title: "Não entra" }),
      ),
    );
    expect(task.status).toBe(422);
    expect(task.extra).toMatchObject({ archived: true });
    expect(
      (
        await hubError(
          inTx(ctxFor(h, todos, "mcp"), (t) =>
            createTask(t, { project: "ARQ", title: "Nem pelo agente" }),
          ),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await hubError(
          inTx(asOwner(), (t) =>
            updateWorkstream(t, workstream, { title: "Mudou" }),
          ),
        )
      ).status,
    ).toBe(422);
    expect(
      (await hubError(inTx(asOwner(), (t) => archiveProject(t, "ARQ")))).status,
    ).toBe(422);
  });

  it("cliente com projeto ativo não arquiva; projeto volta só com o cliente ativo", async () => {
    // Fora da transação: o banco de teste atende um pedido por vez.
    const vitClient = (
      await h.raw.query<{ client_id: string }>(
        `select client_id from ${S}.projects where id = $1`,
        [h.vit],
      )
    ).rows[0].client_id;
    const busy = await hubError(
      inTx(asOwner(), (t) => archiveClient(t, vitClient)),
    );
    expect(busy.status).toBe(422);
    expect(busy.detail).toMatch(/VIT/);

    await inTx(asOwner(), (t) => archiveClient(t, client));
    expect(
      (await inTx(asOwner(), (t) => archivedClients(t))).map((c) => c.id),
    ).toContain(client);
    const needsClient = await hubError(
      inTx(asOwner(), (t) => restoreProject(t, "ARQ")),
    );
    expect(needsClient.status).toBe(422);
    expect(needsClient.detail).toMatch(/Ótica Teste/);

    await inTx(asOwner(), (t) => restoreClient(t, client));
    expect(await inTx(asOwner(), (t) => restoreProject(t, "ARQ"))).toEqual({
      code: "ARQ",
      status: "active",
    });
    expect(
      await inTx(asOwner(), (t) =>
        createTask(t, { project: "ARQ", title: "Agora entra" }),
      ),
    ).toMatchObject({ project_code: "ARQ" });
  });

  it("sem registro do status anterior, o projeto volta como Pausado", async () => {
    // Arquivado direto no banco, sem a linha project.archived no histórico.
    await h.raw.query(
      `insert into ${S}.projects (workspace_id, client_id, code, name, status, archived_at)
       values ($1, $2, 'PAU', 'Arquivado sem registro', 'archived', now())`,
      [h.ws, client],
    );
    expect(await inTx(asOwner(), (t) => restoreProject(t, "PAU"))).toEqual({
      code: "PAU",
      status: "paused",
    });
  });

  it("equipe comum não arquiva projeto nem cliente", async () => {
    expect(
      (
        await hubError(
          inTx(ctxFor(h, member, "ui"), (t) => archiveProject(t, "VIT")),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await hubError(
          inTx(ctxFor(h, member, "ui"), (t) => archiveClient(t, client)),
        )
      ).status,
    ).toBe(403);
  });
});
