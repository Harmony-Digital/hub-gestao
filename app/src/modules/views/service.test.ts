import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { deleteView, listSavedViews, saveView } from "./service";

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
