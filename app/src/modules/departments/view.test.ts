import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { createTask } from "@/modules/tasks/service";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { setDepartmentView } from "@/modules/views/service";
import { departmentDetail, departmentsOverview } from "./view";

const S = "proj_hub_gestao";
let h: TestHub;
let lia: UserActor;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

beforeAll(async () => {
  h = await openTestHub();
  // A frente do VIT passa a ser do departamento de agentes e automações.
  await h.raw.query(
    `update ${S}.workstreams set department_id =
       (select id from ${S}.departments where slug = 'agentes-e-automacoes')
      where id = $1`,
    [h.vitWorkstream],
  );
  await inTx(asOwner(), async (t) => {
    await createTask(t, {
      project: "VIT",
      title: "Mapear as perguntas frequentes",
      workstream_id: h.vitWorkstream,
      assignee: "me",
    });
    await createTask(t, {
      project: "VIT",
      title: "Escrever as respostas",
      workstream_id: h.vitWorkstream,
    });
  });
  // Projeto em revisão do mesmo departamento: fora da visão.
  const review = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.projects (workspace_id, client_id, code, name, status)
       select workspace_id, client_id, 'VIR', 'Em revisão', 'in_review'
         from ${S}.projects where id = $1 returning id`,
      [h.vit],
    )
  ).rows[0];
  await h.raw.query(
    `insert into ${S}.workstreams (workspace_id, project_id, title, department_id)
     values ($1, $2, 'Frente em revisão',
             (select id from ${S}.departments where slug = 'agentes-e-automacoes'))`,
    [h.ws, review.id],
  );
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('lia@exemplo.com', 'Lia') returning id`,
    )
  ).rows[0];
  await h.raw.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'member')`,
    [h.ws, profile.id],
  );
  lia = {
    type: "user",
    id: profile.id,
    scope: "internal",
    role: "member",
    workspaceId: h.ws,
    name: "Lia",
  };
});

afterAll(async () => {
  await h.db.close();
});

describe("visão por departamento", () => {
  it("conta o trabalho do departamento nos projetos ativos", async () => {
    const cards = await inTx(asOwner(), (t) => departmentsOverview(t));
    expect(cards.find((c) => c.slug === "agentes-e-automacoes")).toMatchObject({
      open: 2,
      inProgress: 0,
      blocked: 0,
      unassigned: 1,
      projects: 1,
    });
  });

  it("detalhe: quadro, carga por responsável e frentes, sem o projeto em revisão", async () => {
    const detail = await inTx(asOwner(), (t) =>
      departmentDetail(t, "agentes-e-automacoes"),
    );
    expect(detail.tasks.map((t) => t.title).sort()).toEqual([
      "Escrever as respostas",
      "Mapear as perguntas frequentes",
    ]);
    expect(detail.load).toEqual([
      {
        key: `user:${h.owner}`,
        name: "Fábio Almeida",
        agent: false,
        open: 1,
        inProgress: 0,
        blocked: 0,
      },
    ]);
    expect(detail.workstreams.map((w) => w.projectCode)).toEqual(["VIT"]);
    // Sem padrão guardado, a tela leva só o filtro do departamento (RF-23).
    expect(detail.views).toEqual({ list: null, board: null });
    await inTx(asOwner(), (t) =>
      setDepartmentView(t, {
        department: "agentes-e-automacoes",
        type: "board",
        query: "depto=agentes-e-automacoes&raia=responsavel",
      }),
    );
    expect(
      (
        await inTx(asOwner(), (t) =>
          departmentDetail(t, "agentes-e-automacoes"),
        )
      ).views,
    ).toEqual({
      list: null,
      board: "depto=agentes-e-automacoes&raia=responsavel",
    });
    const err = await inTx(asOwner(), (t) =>
      departmentDetail(t, "nao-existe"),
    ).catch((e: unknown) => e);
    expect(err instanceof HubError ? err.status : err).toBe(404);
  });

  it("a equipe comum vê só os projetos de que participa", async () => {
    const before = await inTx(ctxFor(h, lia, "ui"), (t) =>
      departmentDetail(t, "agentes-e-automacoes"),
    );
    expect(before.tasks).toEqual([]);
    await h.raw.query(
      `insert into ${S}.project_members (workspace_id, project_id, profile_id, role)
       values ($1, $2, $3, 'member')`,
      [h.ws, h.vit, lia.id],
    );
    const after = await inTx(ctxFor(h, lia, "ui"), (t) =>
      departmentDetail(t, "agentes-e-automacoes"),
    );
    expect(after.tasks).toHaveLength(2);
  });
});
