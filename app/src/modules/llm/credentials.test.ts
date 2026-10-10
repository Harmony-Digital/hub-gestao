import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import {
  createCredential,
  credentialSecret,
  listCredentials,
  revokeCredential,
  rotateCredential,
} from "./credentials";

const S = "proj_hub_gestao";
// Chaves de mentira, só para o teste (formato parecido com o dos provedores).
const FAKE_A = "sk-teste-fake-0000000000000000000000000000AAAA";
const FAKE_B = "sk-teste-fake-1111111111111111111111111111BBBB";
let h: TestHub;

beforeAll(async () => {
  process.env.HUB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  h = await openTestHub();
});
afterAll(async () => {
  await h.db.close();
});
afterEach(() => {
  process.env.HUB_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

const owner = () => ctxFor(h, h.owner_actor, "ui");
const as = (role: UserActor["role"]) =>
  ctxFor(h, { ...h.owner_actor, role }, "ui");

async function status(promise: Promise<unknown>): Promise<number> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HubError);
  return (err as HubError).status;
}

describe("chaves de IA", () => {
  it("o dono guarda a chave cifrada; a lista mostra só os 4 últimos", async () => {
    const created = await inTx(owner(), (t) =>
      createCredential(t, {
        provider: "anthropic",
        label: "Anthropic da Harmony",
        key: FAKE_A,
      }),
    );
    expect(created).toMatchObject({
      provider: "anthropic",
      label: "Anthropic da Harmony",
      last4: "AAAA",
      revokedAt: null,
      agents: 0,
    });
    // No banco, só a cifra; em claro, só para o adaptador.
    const row = await h.raw.query<{ key_ciphertext: string }>(
      `select key_ciphertext from ${S}.llm_credentials where id = $1`,
      [created.id],
    );
    expect(row.rows[0].key_ciphertext).not.toContain(FAKE_A);
    expect(await inTx(owner(), (t) => credentialSecret(t, created.id))).toEqual(
      { provider: "anthropic", key: FAKE_A },
    );
    // O histórico guarda o nome e o final, nunca a chave.
    const log = await h.raw.query<{ after: unknown }>(
      `select after from ${S}.activity_log where entity_id = $1`,
      [created.id],
    );
    expect(JSON.stringify(log.rows)).not.toContain(FAKE_A);
    expect(JSON.stringify(log.rows)).toContain("AAAA");

    // Nome repetido entre as ativas: 409.
    expect(
      await status(
        inTx(owner(), (t) =>
          createCredential(t, {
            provider: "openai",
            label: "anthropic da harmony",
            key: FAKE_B,
          }),
        ),
      ),
    ).toBe(409);

    // Troca: o final muda e o segredo também; revoga: o adaptador não acha mais.
    const rotated = await inTx(owner(), (t) =>
      rotateCredential(t, created.id, FAKE_B),
    );
    expect(rotated.last4).toBe("BBBB");
    expect(rotated.rotatedAt).not.toBeNull();
    expect(
      (await inTx(owner(), (t) => credentialSecret(t, created.id)))?.key,
    ).toBe(FAKE_B);
    await inTx(owner(), (t) => revokeCredential(t, created.id));
    expect(await inTx(owner(), (t) => credentialSecret(t, created.id))).toBe(
      null,
    );
    expect(
      await status(
        inTx(owner(), (t) => rotateCredential(t, created.id, FAKE_A)),
      ),
    ).toBe(422);
  });

  it("só o dono cadastra; a administração vê a lista; o resto, nada", async () => {
    const input = { provider: "xai" as const, label: "Grok", key: FAKE_A };
    expect(
      await status(inTx(as("admin"), (t) => createCredential(t, input))),
    ).toBe(403);
    expect(
      Array.isArray(await inTx(as("admin"), (t) => listCredentials(t))),
    ).toBe(true);
    expect(await status(inTx(as("member"), (t) => listCredentials(t)))).toBe(
      403,
    );
    const agent = await agentActor(h, h.keys.todos);
    expect(
      await status(
        inTx(ctxFor(h, agent, "api"), (t) => createCredential(t, input)),
      ),
    ).toBe(403);
  });

  it("sem HUB_ENCRYPTION_KEY no servidor, não guarda", async () => {
    delete process.env.HUB_ENCRYPTION_KEY;
    expect(
      await status(
        inTx(owner(), (t) =>
          createCredential(t, {
            provider: "openai",
            label: "Sem cifra",
            key: FAKE_A,
          }),
        ),
      ),
    ).toBe(500);
  });
});
