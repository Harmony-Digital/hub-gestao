import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applySeed, openLocalDatabase } from "./local";
import { ensureDevSample } from "./dev-sample";
import type { Db } from "./types";

const S = "proj_hub_gestao";
let db: Db;
let raw: PGlite;

beforeAll(async () => {
  ({ db, raw } = await openLocalDatabase());
  await applySeed(raw);
});

afterAll(async () => {
  await db.close();
});

const n = async (sql: string) =>
  (await raw.query<{ n: number }>(sql)).rows[0].n;

describe("dados de exemplo do banco local", () => {
  it("criam um projeto completo pelo núcleo, com histórico", async () => {
    await ensureDevSample(db, raw);
    const p = `(select id from ${S}.projects where code = 'EXE')`;
    expect(
      await n(
        `select count(*)::int as n from ${S}.milestones where project_id = ${p}`,
      ),
    ).toBe(4);
    expect(
      await n(
        `select count(*)::int as n from ${S}.milestones where project_id = ${p} and status = 'accepted'`,
      ),
    ).toBe(1);
    expect(
      await n(
        `select count(*)::int as n from ${S}.workstreams where project_id = ${p}`,
      ),
    ).toBe(4);
    expect(
      await n(
        `select count(*)::int as n from ${S}.workstreams where project_id = ${p} and visibility = 'client'`,
      ),
    ).toBe(2);
    expect(
      await n(
        `select count(*)::int as n from ${S}.tasks where project_id = ${p}`,
      ),
    ).toBe(7);
    for (const [category, count] of [
      ["done", 1],
      ["blocked", 1],
      ["review", 1],
      ["in_progress", 1],
      ["todo", 3],
    ] as const) {
      expect(
        await n(
          `select count(*)::int as n from ${S}.tasks where project_id = ${p} and status_category = '${category}'`,
        ),
      ).toBe(count);
    }
    expect(
      await n(
        `select count(*)::int as n from ${S}.comments where project_id = ${p}`,
      ),
    ).toBe(1);
    expect(
      await n(
        `select count(*)::int as n from ${S}.activity_log where project_id = ${p} and actor_type = 'agent'`,
      ),
    ).toBeGreaterThan(5);
  });

  it("pode rodar de novo sem duplicar nada", async () => {
    await ensureDevSample(db, raw);
    expect(
      await n(
        `select count(*)::int as n from ${S}.projects where code = 'EXE'`,
      ),
    ).toBe(1);
    expect(
      await n(
        `select count(*)::int as n from ${S}.tasks where project_id = (select id from ${S}.projects where code = 'EXE')`,
      ),
    ).toBe(7);
  });
});
