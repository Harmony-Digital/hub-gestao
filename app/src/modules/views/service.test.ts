import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import {
  deleteView,
  departmentViews,
  listSavedViews,
  resetDepartmentView,
  saveView,
  setDepartmentView,
  storedDepartmentViews,
} from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
let other: UserActor;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

beforeAll(async () => {
  h = await openTestHub();
  const profile = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.profiles (email, full_name) values ('bia@exemplo.com', 'Bia') returning id`,
    )
  ).rows[0];
  await h.raw.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'admin')`,
    [h.ws, profile.id],
  );
  other = {
    type: "user",
    id: profile.id,
    scope: "internal",
    role: "admin",
    workspaceId: h.ws,
    name: "Bia",
  };
});

afterAll(async () => {
  await h.db.close();
});

describe("visões salvas", () => {
  it("cada pessoa salva, vê e apaga só as próprias", async () => {
    const view = await inTx(asOwner(), (t) =>
      saveView(t, "VIT", {
        type: "list",
        name: " Minhas urgentes ",
        query: "resp=eu&prio=urgent",
      }),
    );
    expect(view).toMatchObject({
      name: "Minhas urgentes",
      query: "resp=eu&prio=urgent",
    });
    expect(
      (await inTx(asOwner(), (t) => listSavedViews(t, h.vit, "list"))).map(
        (v) => v.name,
      ),
    ).toEqual(["Minhas urgentes"]);
    expect(
      await inTx(asOwner(), (t) => listSavedViews(t, h.vit, "board")),
    ).toEqual([]);
    expect(
      await inTx(ctxFor(h, other, "ui"), (t) =>
        listSavedViews(t, h.vit, "list"),
      ),
    ).toEqual([]);
    const err = await inTx(ctxFor(h, other, "ui"), (t) =>
      deleteView(t, view.id),
    ).catch((e: unknown) => e);
    expect((err as HubError).status).toBe(404);
    await inTx(asOwner(), (t) => deleteView(t, view.id));
    expect(
      await inTx(asOwner(), (t) => listSavedViews(t, h.vit, "list")),
    ).toEqual([]);
  });

  it("recusa nome vazio", async () => {
    const err = await inTx(asOwner(), (t) =>
      saveView(t, "VIT", { type: "list", name: "  ", query: "" }),
    ).catch((e: unknown) => e);
    expect((err as HubError).status).toBe(400);
  });
});

describe("visão padrão do departamento (RF-23)", () => {
  let lead: UserActor;
  let member: UserActor;
  let depts: { id: string; slug: string; name: string; color: string }[];

  beforeAll(async () => {
    const person = async (email: string, name: string) => {
      const profile = (
        await h.raw.query<{ id: string }>(
          `insert into ${S}.profiles (email, full_name) values ($1, $2) returning id`,
          [email, name],
        )
      ).rows[0];
      await h.raw.query(
        `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'member')`,
        [h.ws, profile.id],
      );
      return {
        type: "user",
        id: profile.id,
        scope: "internal",
        role: "member",
        workspaceId: h.ws,
        name,
      } satisfies UserActor;
    };
    lead = await person("lia@exemplo.com", "Lia");
    member = await person("rui@exemplo.com", "Rui");
    await h.raw.query(
      `update ${S}.departments set lead_profile_id = $1 where slug = 'design'`,
      [lead.id],
    );
    depts = (
      await h.raw.query<{
        id: string;
        slug: string;
        name: string;
        color: string;
      }>(
        `select id, slug, name, color from ${S}.departments
          where slug in ('sistemas', 'design') order by sort_order`,
      )
    ).rows;
  });

  const as = (actor: UserActor) => ctxFor(h, actor, "ui");
  const views = (actor: UserActor, type: "list" | "board" = "list") =>
    inTx(as(actor), (t) => departmentViews(t, depts, type));
  const status = (promise: Promise<unknown>) =>
    promise.then(
      () => 0,
      (e: unknown) => (e as HubError).status,
    );

  it("sem padrão guardado, cada departamento vem sem endereço; muda quem pode", async () => {
    expect(await views(member)).toEqual([
      expect.objectContaining({
        slug: "sistemas",
        stored: null,
        canEdit: false,
      }),
      expect.objectContaining({ slug: "design", stored: null, canEdit: false }),
    ]);
    // O dono muda todos; o responsável, só o departamento dele.
    expect((await views(h.owner_actor)).map((v) => v.canEdit)).toEqual([
      true,
      true,
    ]);
    expect((await views(lead)).map((v) => v.canEdit)).toEqual([false, true]);
  });

  it("o responsável guarda o padrão da Lista; vale para todos e só nessa tela", async () => {
    await inTx(as(lead), (t) =>
      setDepartmentView(t, {
        department: "design",
        type: "list",
        query: "depto=design&prio=urgent&agrupar=responsavel",
      }),
    );
    const forMember = await views(member);
    expect(forMember[1]).toMatchObject({
      slug: "design",
      stored: "depto=design&prio=urgent&agrupar=responsavel",
    });
    expect(forMember[0].stored).toBeNull();
    expect((await views(member, "board"))[1].stored).toBeNull();
    // Não aparece entre as visões pessoais de ninguém.
    expect(
      await inTx(as(lead), (t) => listSavedViews(t, h.vit, "list")),
    ).toEqual([]);

    // Guardar de novo troca o anterior (um padrão por tela).
    await inTx(asOwner(), (t) =>
      setDepartmentView(t, {
        department: "design",
        type: "list",
        query: "depto=design&ordem=prazo",
      }),
    );
    const design = depts.find((d) => d.slug === "design")!;
    expect(
      await inTx(asOwner(), (t) => storedDepartmentViews(t, design.id)),
    ).toEqual({ list: "depto=design&ordem=prazo", board: null });
    const rows = await h.raw.query(
      `select 1 from ${S}.saved_views where department_id = $1 and project_id is null`,
      [design.id],
    );
    expect(rows.rows).toHaveLength(1);
    const logged = await h.raw.query<{ action: string }>(
      `select action from ${S}.activity_log
        where entity_type = 'department' and entity_id = $1 order by id`,
      [design.id],
    );
    expect(logged.rows.map((r) => r.action)).toEqual([
      "department.view_set",
      "department.view_set",
    ]);
  });

  it("recusa quem não pode, endereço sem o departamento e frente", async () => {
    const set = (actor: UserActor, department: string, query: string) =>
      status(
        inTx(as(actor), (t) =>
          setDepartmentView(t, { department, type: "board", query }),
        ),
      );
    expect(await set(member, "design", "depto=design")).toBe(403);
    expect(await set(lead, "sistemas", "depto=sistemas")).toBe(403);
    expect(await set(lead, "nao-existe", "depto=nao-existe")).toBe(404);
    expect(await set(lead, "design", "prio=urgent")).toBe(400);
    expect(await set(lead, "design", "depto=sistemas")).toBe(400);
    expect(
      await set(
        lead,
        "design",
        "depto=design&frente=4dc6721e-2ac8-463d-84cb-3b25ab170bbd",
      ),
    ).toBe(400);
    expect(
      await set(lead, "design", `depto=design&busca=${"x".repeat(600)}`),
    ).toBe(422);
    // Agente não tem visão: filtra pela API.
    expect(
      await status(
        inTx(ctxFor(h, await agentActor(h, h.keys.kratos), "mcp"), (t) =>
          setDepartmentView(t, {
            department: "design",
            type: "board",
            query: "depto=design",
          }),
        ),
      ),
    ).toBe(400);
  });

  it("voltar ao padrão do Hub apaga o guardado; sem nada guardado, não registra", async () => {
    const design = depts.find((d) => d.slug === "design")!;
    await inTx(as(lead), (t) =>
      resetDepartmentView(t, { department: "design", type: "list" }),
    );
    expect(
      await inTx(asOwner(), (t) => storedDepartmentViews(t, design.id)),
    ).toEqual({ list: null, board: null });
    await inTx(as(lead), (t) =>
      resetDepartmentView(t, { department: "design", type: "list" }),
    );
    const logged = await h.raw.query<{ action: string }>(
      `select action from ${S}.activity_log
        where entity_type = 'department' and entity_id = $1 and action = 'department.view_reset'`,
      [design.id],
    );
    expect(logged.rows).toHaveLength(1);
    expect(
      await status(
        inTx(as(member), (t) =>
          resetDepartmentView(t, { department: "design", type: "list" }),
        ),
      ),
    ).toBe(403);
  });
});
