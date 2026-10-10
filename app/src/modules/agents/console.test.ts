import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { openTestHub, ctxFor, type TestHub } from "@/test/hub";
import { inTx } from "@/modules/context";
import { listAgentsConsole } from "./service";

let h: TestHub;
const S = "proj_hub_gestao";

beforeAll(async () => {
  h = await openTestHub();
});

afterAll(async () => {
  await h.db.close();
});

const asUser = (role: UserActor["role"]): UserActor => ({
  ...h.owner_actor,
  role,
});

describe("console de agentes", () => {
  it("o dono vê os agentes e as chaves, com projetos e situação", async () => {
    const data = await inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
      listAgentsConsole(t),
    );
    expect(data.canManage).toBe(true);
    expect(data.canManageKeys).toBe(true);
    // Os três nascem na mesma transação: mesmo instante, ordem pelo nome.
    expect(data.agents.map((a) => a.name)).toEqual([
      "Executor",
      "Kratos",
      "Pausado",
    ]);

    const kratos = data.agents.find((a) => a.name === "Kratos")!;
    expect(kratos.kind).toBe("hermes");
    expect(kratos.keys).toHaveLength(1);
    expect(kratos.keys[0]).toMatchObject({
      projects: ["VIT"],
      state: "ativa",
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(kratos.keys[0].prefix).toMatch(/^hub_ak_[a-z0-9]+$/);
    expect(kratos.keys[0].scopes).toContain("tasks:complete");

    const executor = data.agents.find((a) => a.name === "Executor")!;
    expect(executor.keys.map((k) => k.projects)).toEqual(
      expect.arrayContaining(["all", ["VIT"]]),
    );
    expect(data.agents.find((a) => a.name === "Pausado")!.status).toBe(
      "paused",
    );
  });

  it("nunca devolve o valor nem o hash da chave", async () => {
    const data = await inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
      listAgentsConsole(t),
    );
    const text = JSON.stringify(data);
    expect(text).not.toContain(h.keys.kratos);
    expect(text).not.toMatch(/key_hash|[0-9a-f]{64}/);
  });

  it("mostra chave revogada e chave vencida com a situação certa", async () => {
    const kratosKey = (
      await h.raw.query<{ id: string }>(
        `select k.id from ${S}.agent_api_keys k join ${S}.agents a on a.id = k.agent_id where a.name = 'Kratos'`,
      )
    ).rows[0].id;
    const later = new Date(Date.now() + 400 * 24 * 3600 * 1000);
    const vencida = await inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
      listAgentsConsole(t, later),
    );
    expect(vencida.agents.find((a) => a.name === "Kratos")!.keys[0].state).toBe(
      "vencida",
    );

    await h.raw.query(
      `update ${S}.agent_api_keys set revoked_at = now() where id = $1`,
      [kratosKey],
    );
    const revogada = await inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
      listAgentsConsole(t),
    );
    expect(
      revogada.agents.find((a) => a.name === "Kratos")!.keys[0].state,
    ).toBe("revogada");
  });

  it("administração cadastra agentes, mas não vê nem cria chaves", async () => {
    const data = await inTx(ctxFor(h, asUser("admin"), "ui"), (t) =>
      listAgentsConsole(t),
    );
    expect(data.canManage).toBe(true);
    expect(data.canManageKeys).toBe(false);
    expect(data.agents.every((a) => a.keys.length === 0)).toBe(true);
  });

  it("a equipe só vê os agentes", async () => {
    const data = await inTx(ctxFor(h, asUser("member"), "ui"), (t) =>
      listAgentsConsole(t),
    );
    expect(data.canManage).toBe(false);
    expect(data.canManageKeys).toBe(false);
    expect(data.agents).toHaveLength(3);
    expect(data.agents.every((a) => a.keys.length === 0)).toBe(true);
  });
});
