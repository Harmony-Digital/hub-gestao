import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { toHubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { getProject, listProjects } from "@/modules/projects/service";
import { createTask, listTasks } from "@/modules/tasks/service";
import { teamInviteEmail } from "@/modules/workspace/team-invite";
import { memberInviteTarget } from "@/modules/workspace/settings";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";
import {
  listProjectMembers,
  myProjectRole,
  removeProjectMember,
  setProjectMember,
  teamForProjects,
} from "./members";

const S = "proj_hub_gestao";
let h: TestHub;
let rui: UserActor;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asRui = () => ctxFor(h, rui, "ui");
const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 0,
    (e: unknown) => toHubError(e).status,
  );

beforeAll(async () => {
  h = await openTestHub();
  const id = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('rui.projeto@exemplo.com', 'Rui Lima') returning id`,
    )
  ).rows[0].id;
  await h.raw.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'member')`,
    [h.ws, id],
  );
  rui = {
    type: "user",
    id,
    scope: "internal",
    role: "member",
    workspaceId: h.ws,
    name: "Rui Lima",
  };
});

afterAll(async () => {
  await h.db.close();
});

describe("pessoas no projeto (RF-03)", () => {
  it("fora do projeto, a pessoa da equipe comum não vê o projeto", async () => {
    expect(
      (await inTx(asRui(), (t) => listProjects(t))).items.map((p) => p.code),
    ).not.toContain("VIT");
    expect(await status(inTx(asRui(), (t) => getProject(t, "VIT")))).toBe(403);
    expect(
      (await inTx(asOwner(), (t) => teamForProjects(t))).map((p) => p.name),
    ).toContain("Rui Lima");
  });

  it("convidado acompanha o projeto, mas não muda nada", async () => {
    await inTx(asOwner(), (t) =>
      setProjectMember(t, "VIT", { profile_id: rui.id, role: "guest" }),
    );
    expect(await inTx(asOwner(), (t) => listProjectMembers(t, "VIT"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Rui Lima", role: "guest" }),
      ]),
    );
    expect((await inTx(asRui(), (t) => getProject(t, "VIT"))).code).toBe("VIT");
    expect(await inTx(asRui(), (t) => myProjectRole(t, h.vit))).toBe("guest");
    expect(
      await inTx(asRui(), (t) => listTasks(t, { project: "VIT" })),
    ).toMatchObject({ items: expect.any(Array) });
    expect(
      await status(
        inTx(asRui(), (t) =>
          createTask(t, { project: "VIT", title: "Tentativa do convidado" }),
        ),
      ),
    ).toBe(403);
  });

  it("como Equipe, trabalha no projeto; tirar tira o acesso; tudo no histórico", async () => {
    await inTx(asOwner(), (t) =>
      setProjectMember(t, "VIT", { profile_id: rui.id, role: "member" }),
    );
    const task = await inTx(asRui(), (t) =>
      createTask(t, { project: "VIT", title: "Feita pela equipe" }),
    );
    expect(task.code).toMatch(/^HUB-/);
    await inTx(asOwner(), (t) => removeProjectMember(t, "VIT", rui.id));
    expect(await status(inTx(asRui(), (t) => getProject(t, "VIT")))).toBe(403);
    const actions = await h.raw.query<{ action: string }>(
      `select action from ${S}.activity_log where action like 'project.member_%' order by id`,
    );
    expect(actions.rows.map((r) => r.action)).toEqual([
      "project.member_added",
      "project.member_role_changed",
      "project.member_removed",
    ]);
  });

  it("só dono e administração mexem; só gente ativa da equipe; o responsável fica", async () => {
    expect(
      await status(
        inTx(asRui(), (t) =>
          setProjectMember(t, "VIT", { profile_id: rui.id, role: "member" }),
        ),
      ),
    ).toBe(403);
    expect(
      await status(
        inTx(asOwner(), (t) =>
          setProjectMember(t, "VIT", {
            profile_id: "4dc6721e-2ac8-463d-84cb-3b25ab170bbd",
            role: "member",
          }),
        ),
      ),
    ).toBe(404);
    await h.raw.query(
      `update ${S}.projects set owner_profile_id = $2 where id = $1`,
      [h.vit, rui.id],
    );
    await inTx(asOwner(), (t) =>
      setProjectMember(t, "VIT", { profile_id: rui.id, role: "lead" }),
    );
    expect(
      await status(
        inTx(asOwner(), (t) => removeProjectMember(t, "VIT", rui.id)),
      ),
    ).toBe(422);
  });
});

describe("convite da equipe por e-mail (RF-03)", () => {
  it("o texto diz por onde entrar, com ou sem o link de acesso", () => {
    const withLink = teamInviteEmail({
      name: "Rui Lima",
      orgName: "Harmony Digital",
      role: "member",
      loginUrl: "https://hub.exemplo.com.br/login",
      magicLink: true,
    });
    expect(withLink.subject).toBe(
      "Você está na equipe da Harmony Digital no Hub de Gestão",
    );
    expect(withLink.text).toContain("Olá, Rui!");
    expect(withLink.text).toContain("https://hub.exemplo.com.br/login");
    expect(withLink.text).toContain("peça o link de acesso por e-mail");
    expect(
      teamInviteEmail({
        name: "Ana",
        orgName: "Harmony Digital",
        role: "admin",
        loginUrl: "https://hub.exemplo.com.br/login",
        magicLink: false,
      }).text,
    ).toContain("com o papel de administração");
  });

  it("só o dono manda, e só para outra pessoa ativa da equipe", async () => {
    expect(
      await inTx(asOwner(), (t) => memberInviteTarget(t, rui.id)),
    ).toMatchObject({ email: "rui.projeto@exemplo.com", role: "member" });
    expect(
      await status(inTx(asRui(), (t) => memberInviteTarget(t, rui.id))),
    ).toBe(403);
    expect(
      await status(inTx(asOwner(), (t) => memberInviteTarget(t, h.owner))),
    ).toBe(404);
  });
});
