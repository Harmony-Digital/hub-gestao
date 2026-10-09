import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { migrationsDir, openLocalDatabase } from "./local";
import { withActor } from "./actor";
import type { Db } from "./types";

const S = "proj_hub_gestao";
let db: Db;
let raw: PGlite;
let seed: string;

async function snapshot() {
  const one = async <T>(sql: string) => (await raw.query<T>(sql)).rows[0];
  const n = async (sql: string) => (await one<{ n: number }>(sql)).n;
  return {
    workspaces: await n(`select count(*)::int as n from ${S}.workspaces`),
    profiles: await n(`select count(*)::int as n from ${S}.profiles`),
    owners: await n(
      `select count(*)::int as n from ${S}.memberships where role = 'owner'`,
    ),
    departments: await n(`select count(*)::int as n from ${S}.departments`),
    clients: await n(`select count(*)::int as n from ${S}.clients`),
    projects: await n(`select count(*)::int as n from ${S}.projects`),
    statuses: await n(`select count(*)::int as n from ${S}.task_statuses`),
    defaultStatus: (
      await one<{ name: string }>(
        `select name from ${S}.task_statuses where is_default`,
      )
    ).name,
    projectLeads: await n(
      `select count(*)::int as n from ${S}.project_members where role = 'lead'`,
    ),
  };
}

beforeAll(async () => {
  ({ db, raw } = await openLocalDatabase());
  seed = await readFile(
    path.resolve(migrationsDir(), "..", "seeds", "harmony_workspace.sql"),
    "utf8",
  );
});

afterAll(async () => {
  await db.close();
});

describe("seed do workspace da Harmony", () => {
  const expected = {
    workspaces: 1,
    profiles: 1,
    owners: 1,
    departments: 9,
    clients: 1,
    projects: 1,
    statuses: 5,
    defaultStatus: "A fazer",
    projectLeads: 1,
  };

  it("cria dono, departamentos, cliente interno, projeto HUB e status padrão", async () => {
    await raw.exec(seed);
    expect(await snapshot()).toEqual(expected);
  });

  it("pode rodar de novo sem duplicar nada", async () => {
    await raw.exec(seed);
    expect(await snapshot()).toEqual(expected);
  });

  it("o dono enxerga o projeto HUB pelas regras de acesso", async () => {
    const ids = (
      await raw.query<{ ws: string; owner: string }>(
        `select w.id as ws, m.profile_id as owner
           from ${S}.workspaces w join ${S}.memberships m on m.workspace_id = w.id
          where w.slug = 'harmony' and m.role = 'owner'`,
      )
    ).rows[0];
    const codes = await withActor(
      db,
      {
        type: "user",
        id: ids.owner,
        scope: "internal",
        role: "owner",
        workspaceId: ids.ws,
        name: "Fábio Almeida",
      },
      async (tx) =>
        (
          await tx.query<{ code: string }>(`select code from ${S}.projects`)
        ).rows.map((r) => r.code),
    );
    expect(codes).toEqual(["HUB"]);
  });
});
