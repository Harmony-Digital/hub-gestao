import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import {
  logoKind,
  logoVersions,
  MAX_LOGO_BYTES,
  readClientLogo,
  removeClientLogo,
  setClientLogo,
} from "@/modules/clients/logo";
import { inTx } from "@/modules/context";
import { addMember } from "@/modules/workspace/settings";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";

const S = "proj_hub_gestao";
let h: TestHub;
let clientId: string;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56,
]);

beforeAll(async () => {
  h = await openTestHub();
  clientId = (
    await h.raw.query<{ id: string }>(
      `select id from ${S}.clients where slug = 'clinica-exemplo'`,
    )
  ).rows[0].id;
});
afterAll(async () => {
  await h.db.close();
});

const asOwner = () => ctxFor(h, h.owner_actor, "ui");

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

describe("logo do cliente (RF-04): o arquivo", () => {
  it("aceita PNG, JPG e WebP conferidos pelos primeiros bytes", () => {
    expect(logoKind({ name: "logo.png", bytes: PNG })).toBe("image/png");
    expect(logoKind({ name: "C:\\fotos\\logo.JPEG", bytes: JPG })).toBe(
      "image/jpeg",
    );
    expect(logoKind({ name: "logo.webp", bytes: WEBP })).toBe("image/webp");
  });

  it("recusa SVG, nome que mente, vazio e acima de 1 MB", () => {
    const fails = (name: string, bytes: Uint8Array) => {
      try {
        logoKind({ name, bytes });
        return null;
      } catch (err) {
        return err instanceof HubError ? err.status : 500;
      }
    };
    const svg = new TextEncoder().encode("<svg onload='alert(1)'></svg>");
    expect(fails("logo.svg", svg)).toBe(422);
    expect(fails("logo.png", JPG)).toBe(422);
    expect(fails("logo.gif", PNG)).toBe(422);
    expect(fails("logo.png", new Uint8Array())).toBe(400);
    const big = new Uint8Array(MAX_LOGO_BYTES + 1);
    big.set(PNG);
    expect(fails("logo.png", big)).toBe(422);
  });
});

describe("logo do cliente (RF-04): enviar, trocar e remover", () => {
  it("o dono envia, troca e remove; a versão muda com o arquivo", async () => {
    const first = await inTx(asOwner(), (t) =>
      setClientLogo(t, clientId, { name: "logo.png", bytes: PNG }),
    );
    expect(first.version).toBe(
      createHash("sha256").update(PNG).digest("hex").slice(0, 12),
    );
    expect((await inTx(asOwner(), (t) => logoVersions(t))).get(clientId)).toBe(
      first.version,
    );
    const logo = await inTx(asOwner(), (t) =>
      readClientLogo(t, "clinica-exemplo"),
    );
    expect(logo?.mime).toBe("image/png");
    expect([...(logo?.content ?? [])]).toEqual([...PNG]);

    const second = await inTx(asOwner(), (t) =>
      setClientLogo(t, clientId, { name: "logo.webp", bytes: WEBP }),
    );
    expect(second.version).not.toBe(first.version);
    expect(
      (await inTx(asOwner(), (t) => readClientLogo(t, "clinica-exemplo")))
        ?.mime,
    ).toBe("image/webp");

    await inTx(asOwner(), (t) => removeClientLogo(t, clientId));
    expect(
      await inTx(asOwner(), (t) => readClientLogo(t, "clinica-exemplo")),
    ).toBeNull();
    expect(
      await status(inTx(asOwner(), (t) => removeClientLogo(t, clientId))),
    ).toBe(404);

    const history = await h.raw.query<{ action: string }>(
      `select action from ${S}.activity_log
        where entity_type = 'client' and entity_id = $1 and action like 'client.logo_%'
        order by created_at, id`,
      [clientId],
    );
    expect(history.rows.map((r) => r.action)).toEqual([
      "client.logo_changed",
      "client.logo_changed",
      "client.logo_removed",
    ]);
  });

  it("só dono e administração: a equipe e os agentes não mexem no logo", async () => {
    const added = await inTx(asOwner(), (t) =>
      addMember(t, {
        name: "Lia Logo",
        email: "lia.logo@harmony.test",
        role: "member",
      }),
    );
    const member: UserActor = {
      type: "user",
      id: added.profileId,
      scope: "internal",
      role: "member",
      workspaceId: h.ws,
      name: "Lia Logo",
    };
    expect(
      await status(
        inTx(ctxFor(h, member, "ui"), (t) =>
          setClientLogo(t, clientId, { name: "logo.png", bytes: PNG }),
        ),
      ),
    ).toBe(403);
    const agent = ctxFor(h, await agentActor(h, h.keys.todos), "mcp");
    expect(
      await status(
        inTx(agent, (t) =>
          setClientLogo(t, clientId, { name: "logo.png", bytes: PNG }),
        ),
      ),
    ).toBe(403);
  });

  it("cliente que não existe é 404; arquivado não muda", async () => {
    expect(
      await status(
        inTx(asOwner(), (t) =>
          setClientLogo(t, "00000000-0000-4000-8000-000000000000", {
            name: "logo.png",
            bytes: PNG,
          }),
        ),
      ),
    ).toBe(404);
    await h.raw.query(
      `update ${S}.clients set archived_at = now() where id = $1`,
      [clientId],
    );
    expect(
      await status(
        inTx(asOwner(), (t) =>
          setClientLogo(t, clientId, { name: "logo.png", bytes: PNG }),
        ),
      ),
    ).toBe(422);
    await h.raw.query(
      `update ${S}.clients set archived_at = null where id = $1`,
      [clientId],
    );
  });
});
