import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import {
  addMember,
  createDepartment,
  emailTestTarget,
  removeDepartment,
  renameWorkspace,
  setDepartmentLead,
  setMemberRole,
  setMemberStatus,
  updateDepartment,
  workspaceSettings,
} from "./settings";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

beforeAll(async () => {
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});

describe("configurações do workspace", () => {
  it("mostra o workspace, a equipe e os departamentos", async () => {
    const settings = await inTx(asOwner(), (t) => workspaceSettings(t));
    expect(settings.workspace.slug).toBe("harmony");
    expect(settings.team).toContainEqual(
      expect.objectContaining({ role: "owner", me: true, status: "active" }),
    );
    expect(settings.departments.length).toBeGreaterThan(0);
  });

  it("o dono põe gente na equipe, muda o papel e suspende; nunca a si mesmo", async () => {
    const { profileId } = await inTx(asOwner(), (t) =>
      addMember(t, {
        name: "Pessoa Nova",
        email: "Nova@Harmony.test",
        role: "member",
      }),
    );
    // De novo, o mesmo e-mail: já está na equipe.
    expect(
      await status(
        inTx(asOwner(), (t) =>
          addMember(t, {
            name: "Outra",
            email: "nova@harmony.test",
            role: "member",
          }),
        ),
      ),
    ).toBe(409);
    await inTx(asOwner(), (t) => setMemberRole(t, profileId, "admin"));
    await inTx(asOwner(), (t) => setMemberStatus(t, profileId, "suspended"));
    const row = await h.raw.query<{ role: string; status: string }>(
      `select role::text as role, status from ${S}.memberships where profile_id = $1`,
      [profileId],
    );
    expect(row.rows[0]).toEqual({ role: "admin", status: "suspended" });
    await inTx(asOwner(), (t) => setMemberStatus(t, profileId, "active"));
    const log = await h.raw.query<{ action: string }>(
      `select action from ${S}.activity_log where entity_id = $1 order by id`,
      [profileId],
    );
    expect(log.rows.map((r) => r.action)).toEqual([
      "member.added",
      "member.role_changed",
      "member.suspended",
      "member.reactivated",
    ]);
    // O dono não muda a si mesmo.
    expect(
      await status(
        inTx(asOwner(), (t) => setMemberStatus(t, h.owner, "suspended")),
      ),
    ).toBe(422);
  });

  it("e-mail de contato de cliente não entra na equipe", async () => {
    await h.raw.query(
      `with p as (
         insert into ${S}.profiles (email, full_name) values ('contato@cliente.test', 'Contato')
         returning id)
       insert into ${S}.client_contacts (workspace_id, client_id, profile_id, name, email)
       select $1, c.id, p.id, 'Contato', 'contato@cliente.test'
         from ${S}.clients c, p where c.slug = 'clinica-exemplo'`,
      [h.ws],
    );
    expect(
      await status(
        inTx(asOwner(), (t) =>
          addMember(t, {
            name: "Contato",
            email: "contato@cliente.test",
            role: "member",
          }),
        ),
      ),
    ).toBe(422);
  });

  it("renomeia o workspace e escolhe o responsável do departamento", async () => {
    await inTx(asOwner(), (t) =>
      renameWorkspace(t, { name: "Harmony Digital (teste)" }),
    );
    const settings = await inTx(asOwner(), (t) => workspaceSettings(t));
    expect(settings.workspace.name).toBe("Harmony Digital (teste)");
    const department = settings.departments[0];
    await inTx(asOwner(), (t) => setDepartmentLead(t, department.id, h.owner));
    const after = await inTx(asOwner(), (t) => workspaceSettings(t));
    expect(
      after.departments.find((d) => d.id === department.id)?.leadProfileId,
    ).toBe(h.owner);
    // Quem não está ativo na equipe não vira responsável.
    const suspended = await inTx(asOwner(), (t) =>
      addMember(t, {
        name: "Saiu",
        email: "saiu@harmony.test",
        role: "member",
      }),
    );
    await inTx(asOwner(), (t) =>
      setMemberStatus(t, suspended.profileId, "suspended"),
    );
    expect(
      await status(
        inTx(asOwner(), (t) =>
          setDepartmentLead(t, department.id, suspended.profileId),
        ),
      ),
    ).toBe(422);
  });

  it("administração vê e escolhe responsável, mas não mexe na equipe; agente nunca", async () => {
    const { profileId } = await inTx(asOwner(), (t) =>
      addMember(t, {
        name: "Administração",
        email: "adm@harmony.test",
        role: "admin",
      }),
    );
    const admin: UserActor = {
      type: "user",
      id: profileId,
      scope: "internal",
      role: "admin",
      workspaceId: h.ws,
      name: "Administração",
    };
    const asAdmin = ctxFor(h, admin, "ui");
    const settings = await inTx(asAdmin, (t) => workspaceSettings(t));
    expect(settings.team.find((m) => m.me)?.role).toBe("admin");
    expect(
      await status(
        inTx(asAdmin, (t) =>
          setDepartmentLead(t, settings.departments[0].id, null),
        ),
      ),
    ).toBe(200);
    expect(
      await status(
        inTx(asAdmin, (t) =>
          addMember(t, { name: "X", email: "x@harmony.test", role: "member" }),
        ),
      ),
    ).toBe(403);
    const agent = await agentActor(h, h.keys.todos);
    expect(
      await status(inTx(ctxFor(h, agent), (t) => workspaceSettings(t))),
    ).toBe(403);
    // O e-mail de teste é só do dono, para o próprio endereço.
    expect(await status(inTx(asAdmin, (t) => emailTestTarget(t)))).toBe(403);
  });

  it("o e-mail de teste vai para o próprio dono, com o nome do workspace", async () => {
    const target = await inTx(asOwner(), (t) => emailTestTarget(t));
    const me = await h.raw.query<{ email: string }>(
      `select email from ${S}.profiles where id = $1`,
      [h.owner],
    );
    expect(target.email).toBe(me.rows[0].email);
    expect(target.orgName).toBeTruthy();
  });
});

describe("departamentos (RF-27)", () => {
  it("cria no fim da lista, com o endereço tirado do nome; nome repetido é 409", async () => {
    const created = await inTx(asOwner(), (t) =>
      createDepartment(t, { name: "Pesquisa & Dados", color: "#1f6feb" }),
    );
    expect(created.slug).toBe("pesquisa-dados");
    const settings = await inTx(asOwner(), (t) => workspaceSettings(t));
    expect(settings.departments.at(-1)).toMatchObject({
      id: created.id,
      name: "Pesquisa & Dados",
      slug: "pesquisa-dados",
      color: "#1F6FEB",
      usage: { projects: 0, workstreams: 0, agents: 0 },
    });
    expect(
      await status(
        inTx(asOwner(), (t) =>
          createDepartment(t, { name: "pesquisa & dados", color: "#000000" }),
        ),
      ),
    ).toBe(409);
    // Outro nome que dá o mesmo endereço ganha um número no fim.
    const twin = await inTx(asOwner(), (t) =>
      createDepartment(t, { name: "Pesquisa / Dados", color: "#000000" }),
    );
    expect(twin.slug).toBe("pesquisa-dados-2");
  });

  it("renomeia e troca a cor sem mudar o endereço; remove só o que ninguém usa", async () => {
    const { id } = await inTx(asOwner(), (t) =>
      createDepartment(t, { name: "Eventos", color: "#AA5500" }),
    );
    await inTx(asOwner(), (t) =>
      updateDepartment(t, id, { name: "Eventos e Feiras", color: "#00aa55" }),
    );
    const row = await h.raw.query<{
      name: string;
      slug: string;
      color: string;
    }>(`select name, slug, color from ${S}.departments where id = $1`, [id]);
    expect(row.rows[0]).toEqual({
      name: "Eventos e Feiras",
      slug: "eventos",
      color: "#00AA55",
    });

    // Em uso por uma frente: não remove e diz onde está.
    await h.raw.query(
      `update ${S}.workstreams set department_id = $2 where id = $1`,
      [h.vitWorkstream, id],
    );
    const err = await inTx(asOwner(), (t) => removeDepartment(t, id)).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({
      status: 422,
      detail: expect.stringContaining("1 frente"),
    });
    await h.raw.query(
      `update ${S}.workstreams set department_id = null where id = $1`,
      [h.vitWorkstream],
    );
    await inTx(asOwner(), (t) => removeDepartment(t, id));
    expect(
      (await h.raw.query(`select 1 from ${S}.departments where id = $1`, [id]))
        .rows,
    ).toEqual([]);
    const history = await h.raw.query<{ action: string }>(
      `select action from ${S}.activity_log
        where entity_type = 'department' and entity_id = $1 order by created_at, id`,
      [id],
    );
    expect(history.rows.map((r) => r.action)).toEqual([
      "department.created",
      "department.updated",
      "department.removed",
    ]);
  });

  it("equipe e agentes não mexem nos departamentos", async () => {
    const { profileId } = await inTx(asOwner(), (t) =>
      addMember(t, {
        name: "Equipe Departamento",
        email: "equipe.departamento@harmony.test",
        role: "member",
      }),
    );
    const member: UserActor = {
      type: "user",
      id: profileId,
      scope: "internal",
      role: "member",
      workspaceId: h.ws,
      name: "Equipe Departamento",
    };
    expect(
      await status(
        inTx(ctxFor(h, member, "ui"), (t) =>
          createDepartment(t, { name: "Novo", color: "#000000" }),
        ),
      ),
    ).toBe(403);
    const agent = await agentActor(h, h.keys.todos);
    expect(
      await status(
        inTx(ctxFor(h, agent), (t) =>
          createDepartment(t, { name: "Novo", color: "#000000" }),
        ),
      ),
    ).toBe(403);
  });
});
