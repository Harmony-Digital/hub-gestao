import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applySeed, openLocalDatabase } from "@/lib/db/local";
import type { Db } from "@/lib/db/types";
import { resolveHubUser, type AuthIdentity } from "./resolve";

const S = "proj_hub_gestao";
const OWNER_EMAIL = "contato@harmonydigital.com.br";
let db: Db;
let raw: PGlite;

const identity = (over: Partial<AuthIdentity> = {}): AuthIdentity => ({
  id: randomUUID(),
  email: OWNER_EMAIL,
  emailConfirmed: true,
  ...over,
});

async function linkedAuthId(email = OWNER_EMAIL): Promise<string | null> {
  const row = (
    await raw.query<{ auth_user_id: string | null }>(
      `select auth_user_id from ${S}.profiles where lower(email) = $1`,
      [email],
    )
  ).rows[0];
  return row?.auth_user_id ?? null;
}

beforeAll(async () => {
  ({ db, raw } = await openLocalDatabase());
  await applySeed(raw);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  // Cada teste começa com o perfil do Fábio sem login ligado, ativo e com vínculo ativo.
  await raw.exec(`
    update ${S}.profiles set auth_user_id = null, deactivated_at = null;
    update ${S}.memberships set status = 'active';
  `);
});

describe("login da equipe: quem é a pessoa no Hub (migration 0010)", () => {
  it("no primeiro login liga o usuário do Supabase Auth ao perfil pelo e-mail confirmado", async () => {
    const who = identity();
    const user = await resolveHubUser(db, who, "harmony");

    expect(user).not.toBeNull();
    expect(user!.linkedNow).toBe(true);
    expect(user!.fullName).toBe("Fábio Almeida");
    expect(user!.actor).toMatchObject({
      type: "user",
      scope: "internal",
      role: "owner",
      name: "Fábio Almeida",
    });
    expect(await linkedAuthId()).toBe(who.id);

    const log = (
      await raw.query<{
        actor_type: string;
        actor_id: string;
        action: string;
        source: string;
      }>(
        `select actor_type::text, actor_id, action, source from ${S}.activity_log
          where action = 'profile.login_linked' order by id desc limit 1`,
      )
    ).rows[0];
    expect(log).toEqual({
      actor_type: "user",
      actor_id: user!.actor.id,
      action: "profile.login_linked",
      source: "ui",
    });
  });

  it("nos logins seguintes vale o vínculo, sem novo registro no histórico", async () => {
    const who = identity();
    await resolveHubUser(db, who, "harmony");
    const before = (
      await raw.query<{ n: number }>(
        `select count(*)::int as n from ${S}.activity_log where action = 'profile.login_linked'`,
      )
    ).rows[0].n;

    const again = await resolveHubUser(
      db,
      { ...who, email: "outro-email@exemplo.com" },
      "harmony",
    );
    expect(again?.linkedNow).toBe(false);
    expect(again?.actor.role).toBe("owner");
    const after = (
      await raw.query<{ n: number }>(
        `select count(*)::int as n from ${S}.activity_log where action = 'profile.login_linked'`,
      )
    ).rows[0].n;
    expect(after).toBe(before);
  });

  it("aceita o e-mail com maiúsculas e espaços, como o GoTrue pode devolver", async () => {
    const user = await resolveHubUser(
      db,
      identity({ email: "  Contato@HarmonyDigital.com.br " }),
      "harmony",
    );
    expect(user?.actor.role).toBe("owner");
  });

  it("não liga e-mail sem confirmação no Supabase Auth", async () => {
    expect(
      await resolveHubUser(db, identity({ emailConfirmed: false }), "harmony"),
    ).toBeNull();
    expect(await linkedAuthId()).toBeNull();
  });

  it("não deixa um segundo usuário do Supabase Auth tomar um perfil já ligado", async () => {
    const first = identity();
    await resolveHubUser(db, first, "harmony");
    expect(await resolveHubUser(db, identity(), "harmony")).toBeNull();
    expect(await linkedAuthId()).toBe(first.id);
  });

  it("e-mail sem perfil no Hub não entra", async () => {
    expect(
      await resolveHubUser(
        db,
        identity({ email: "alguem@exemplo.com" }),
        "harmony",
      ),
    ).toBeNull();
    expect(
      await resolveHubUser(db, identity({ email: null }), "harmony"),
    ).toBeNull();
  });

  it("perfil desativado perde o acesso, mesmo já ligado", async () => {
    const who = identity();
    await resolveHubUser(db, who, "harmony");
    await raw.exec(`update ${S}.profiles set deactivated_at = now()`);
    expect(await resolveHubUser(db, who, "harmony")).toBeNull();
  });

  it("vínculo suspenso com o workspace bloqueia o acesso e o primeiro login", async () => {
    await raw.exec(`update ${S}.memberships set status = 'suspended'`);
    expect(await resolveHubUser(db, identity(), "harmony")).toBeNull();
    expect(await linkedAuthId()).toBeNull();
  });

  it("workspace inexistente não devolve nada", async () => {
    expect(await resolveHubUser(db, identity(), "outro")).toBeNull();
    expect(await linkedAuthId()).toBeNull();
  });

  it("só o papel do app executa a função; um papel qualquer recebe recusa", async () => {
    await raw.exec(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'qualquer') then
          create role qualquer nologin;
        end if;
      end $$;
      grant usage on schema ${S} to qualquer;
    `);
    await expect(
      raw.transaction(async (tx) => {
        await tx.exec("set local role qualquer");
        await tx.query(
          `select * from ${S}.profile_for_auth_user($1, $2, true, 'harmony')`,
          [randomUUID(), OWNER_EMAIL],
        );
      }),
    ).rejects.toThrow(/permission denied/);
    expect(await linkedAuthId()).toBeNull();
  });
});
