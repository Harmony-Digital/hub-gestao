import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { parsePlanFile } from "@/modules/sync/plan-file";
import { templateProblem } from "@/modules/templates/markdown";
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

describe("seed dos modelos de projeto da Harmony", () => {
  const templates = () =>
    raw.query<{
      name: string;
      structure: { markdown: string; departments: string[] };
    }>(`select name, structure from ${S}.project_templates order by name`);

  it("cria os seis modelos iniciais, sem duplicar ao rodar de novo", async () => {
    const file = await readFile(
      path.resolve(migrationsDir(), "..", "seeds", "harmony_templates.sql"),
      "utf8",
    );
    await raw.exec(file);
    await raw.exec(file);
    expect((await templates()).rows.map((r) => r.name)).toEqual([
      "Agente de atendimento WhatsApp",
      "Funil de aquisição",
      "Monitoramento e inteligência",
      "Posicionamento de marca",
      "Sistema sob medida com IA",
      "Site institucional",
    ]);
  });

  it("cada esqueleto passa na conferência e só cita departamentos que existem", async () => {
    const departments = (
      await raw.query<{ slug: string; name: string }>(
        `select slug, name from ${S}.departments`,
      )
    ).rows;
    const slugs = new Set(departments.map((d) => d.slug));
    const names = new Set(departments.map((d) => d.name));
    for (const t of (await templates()).rows) {
      expect(templateProblem(t.structure.markdown), t.name).toBeNull();
      expect(
        t.structure.departments.every((d) => slugs.has(d)),
        t.name,
      ).toBe(true);
      const parsed = parsePlanFile(t.structure.markdown);
      expect(parsed.milestones.length, t.name).toBeGreaterThanOrEqual(3);
      for (const ws of parsed.workstreams) {
        expect(
          ws.department && names.has(ws.department),
          `${t.name}: ${ws.title}`,
        ).toBe(true);
      }
    }
  });
});
