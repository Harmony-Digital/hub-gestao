import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentActor, UserActor } from "@/lib/db/actor";
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
  createClient,
  createProject,
  listClients,
  slugify,
  updateClient,
  updateProject,
  type CreateProjectInput,
} from "./admin";

const S = "proj_hub_gestao";
let h: TestHub;
let member: UserActor;
let kratos: AgentActor;
let clientId: string;

const asOwner = () => ctxFor(h, h.owner_actor, "ui");

function project(over: Partial<CreateProjectInput> = {}): CreateProjectInput {
  return {
    code: "NOVO",
    name: "Projeto novo",
    client_id: clientId,
    phase: "descobrir",
    status: "discovery",
    objective_internal: "Entender o atendimento da clínica.",
    objective_client: null,
    start_date: "2026-10-12",
    target_date: "2026-12-18",
    owner_profile_id: h.owner,
    pm_agent_id: h.agents.kratos,
    repo_url: "https://github.com/Harmony-Digital/exemplo",
    plan_path: "PLAN.md",
    require_evidence: true,
    client_can_confirm_receipt: false,
    departments: ["estrategia", "sistemas"],
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

beforeAll(async () => {
  h = await openTestHub();
  kratos = await agentActor(h, h.keys.todos);
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('membro@exemplo.com', 'Membro da Equipe') returning id`,
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
    name: "Membro da Equipe",
  };
  clientId = (
    await inTx(asOwner(), (t) =>
      createClient(t, { name: "Clínica São José", segment: "Saúde" }),
    )
  ).id;
});

afterAll(async () => {
  await h.db.close();
});

describe("clientes", () => {
  it("cria com endereço curto sem acento e único", async () => {
    const again = await inTx(asOwner(), (t) =>
      createClient(t, { name: "Clínica São José!" }),
    );
    const clients = await inTx(asOwner(), (t) => listClients(t));
    expect(clients.find((c) => c.id === clientId)?.slug).toBe(
      "clinica-sao-jose",
    );
    expect(again.slug).toBe("clinica-sao-jose-2");
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log where action = 'client.created'`,
      ),
    ).toBe(2);
  });

  it("edita nome, segmento e notas, com registro do que mudou", async () => {
    const edited = await inTx(asOwner(), (t) =>
      updateClient(t, clientId, {
        name: "Clínica São José",
        segment: "Saúde e bem-estar",
        notes_internal: "Contato pelo WhatsApp da recepção.",
      }),
    );
    expect(edited.segment).toBe("Saúde e bem-estar");
    const log = await h.raw.query<{ after: Record<string, unknown> }>(
      `select after from ${S}.activity_log where action = 'client.updated' order by id desc limit 1`,
    );
    expect(Object.keys(log.rows[0].after).sort()).toEqual([
      "notes_internal",
      "segment",
    ]);
  });

  it("endereço curto de qualquer nome", () => {
    expect(slugify("  Ótica & Cia. Ltda.  ")).toBe("otica-cia-ltda");
    expect(slugify("!!!")).toBe("cliente");
  });
});

describe("projetos", () => {
  it("cria com status padrão, departamentos, responsável e histórico", async () => {
    const created = await inTx(asOwner(), (t) => createProject(t, project()));
    expect(created).toMatchObject({
      code: "NOVO",
      client: { name: "Clínica São José" },
      phase: "descobrir",
      status: "discovery",
      owner: { name: "Fábio Almeida" },
      pm_agent: { name: "Kratos" },
      require_evidence: true,
    });
    expect(created.departments.map((d) => d.slug).sort()).toEqual([
      "estrategia",
      "sistemas",
    ]);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.task_statuses where project_id = $1`,
        [created.id],
      ),
    ).toBe(5);
    // Já recebe tarefa: o status padrão existe.
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "NOVO", title: "Primeira tarefa" }),
    );
    expect(task.status.name).toBe("A fazer");
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.project_members where project_id = $1 and role = 'lead'`,
        [created.id],
      ),
    ).toBe(1);
  });

  it("recusa código repetido, datas invertidas e departamento que não existe", async () => {
    const repeated = await hubError(
      inTx(asOwner(), (t) => createProject(t, project())),
    );
    expect(repeated.status).toBe(409);
    expect(repeated.detail).toBe("Já existe um projeto com esse código.");

    const dates = await hubError(
      inTx(asOwner(), (t) =>
        createProject(
          t,
          project({
            code: "DATAS",
            start_date: "2026-12-01",
            target_date: "2026-11-01",
          }),
        ),
      ),
    );
    expect(dates.status).toBe(400);

    const department = await hubError(
      inTx(asOwner(), (t) =>
        createProject(
          t,
          project({ code: "DEPTO", departments: ["inexistente"] }),
        ),
      ),
    );
    expect(department.status).toBe(422);
  });

  it("edita só o que mudou e confere a versão lida", async () => {
    const { code: _code, ...fields } = project();
    void _code;
    const current = await inTx(asOwner(), (t) =>
      updateProject(t, "NOVO", fields),
    );
    const logsBefore = await count(
      h,
      `select count(*)::int as n from ${S}.activity_log where action = 'project.updated'`,
    );
    // Sem mudança: não grava nada.
    const same = await inTx(asOwner(), (t) =>
      updateProject(t, "NOVO", fields, current.updated_at),
    );
    expect(same.updated_at).toBe(current.updated_at);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.activity_log where action = 'project.updated'`,
      ),
    ).toBe(logsBefore);

    const changed = await inTx(asOwner(), (t) =>
      updateProject(
        t,
        "NOVO",
        {
          ...fields,
          status: "active",
          phase: "validar",
          departments: ["design"],
        },
        current.updated_at,
      ),
    );
    expect(changed).toMatchObject({ status: "active", phase: "validar" });
    expect(changed.departments.map((d) => d.slug)).toEqual(["design"]);
    const log = await h.raw.query<{ after: Record<string, unknown> }>(
      `select after from ${S}.activity_log where action = 'project.updated' order by id desc limit 1`,
    );
    expect(log.rows[0].after).toEqual({
      phase: "validar",
      status: "active",
      departments: ["design"],
    });

    const stale = await hubError(
      inTx(asOwner(), (t) =>
        updateProject(
          t,
          "NOVO",
          { ...fields, name: "Outro" },
          current.updated_at,
        ),
      ),
    );
    expect(stale.status).toBe(412);
  });

  it("só owner e admin cadastram: equipe comum e agentes não", async () => {
    const asMember = () => ctxFor(h, member, "ui");
    expect(
      (await hubError(inTx(asMember(), (t) => createClient(t, { name: "X" }))))
        .status,
    ).toBe(403);
    expect(
      (
        await hubError(
          inTx(asMember(), (t) => createProject(t, project({ code: "MEMB" }))),
        )
      ).status,
    ).toBe(403);
    const asAgent = () => ctxFor(h, kratos, "mcp");
    const agentError = await hubError(
      inTx(asAgent(), (t) => createProject(t, project({ code: "AGNT" }))),
    );
    expect(agentError.status).toBe(403);
    expect(agentError.extra).toMatchObject({ human_only: true });
  });
});
