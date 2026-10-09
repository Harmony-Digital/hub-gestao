import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  parseEncryptionKey,
  signWebhook,
} from "./crypto";
import { canonicalJson, requestHash } from "./idempotency";
import { decodeCursor, encodeCursor, parseLimit, toPage } from "./pagination";
import { RateLimiter } from "./rate-limit";
import { assertNoSecrets, findSecret } from "./text-guards";

describe("paginação por cursor", () => {
  it("ida e volta do cursor, com microssegundos", () => {
    const position = {
      at: "2026-10-09T18:32:00.123456Z",
      id: "11111111-1111-4111-8111-111111111111",
    };
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it("recusa cursor adulterado e limite fora da faixa", () => {
    expect(() => decodeCursor("nao-e-cursor")).toThrow(/Cursor inválido/);
    expect(() => parseLimit("0")).toThrow(/limit/);
    expect(() => parseLimit("201")).toThrow(/limit/);
    expect(parseLimit(undefined)).toBe(50);
  });

  it("monta a página e o cursor da próxima", () => {
    const rows = [1, 2, 3].map((n) => ({
      cursor_at: `2026-10-09T18:3${n}:00.000000Z`,
      id: `0000000${n}-0000-4000-8000-000000000000`,
    }));
    const page = toPage(rows, 2, (r) => r.id);
    expect(page.items).toHaveLength(2);
    expect(decodeCursor(page.next_cursor)).toEqual({
      at: rows[1].cursor_at,
      id: rows[1].id,
    });
    expect(toPage(rows, 5, (r) => r.id).next_cursor).toBeNull();
  });
});

describe("limite de pedidos", () => {
  it("libera até o limite e pede espera depois", () => {
    const limiter = new RateLimiter(3, 60_000);
    const now = 1_000_000;
    expect(limiter.take("k", now).ok).toBe(true);
    expect(limiter.take("k", now).ok).toBe(true);
    expect(limiter.take("k", now).ok).toBe(true);
    const blocked = limiter.take("k", now);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(limiter.take("k", now + 20_000).ok).toBe(true);
    expect(limiter.take("outra", now).ok).toBe(true);
  });
});

describe("segredos em texto livre", () => {
  it("reconhece chaves e tokens conhecidos", () => {
    expect(
      findSecret("veja hub_ak_abcdefgh1234.AAAAAAAAAAAAAAAAAAAAAAAA"),
    ).toMatch(/Hub/);
    expect(findSecret("sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA")).toMatch(
      /Anthropic/,
    );
    expect(findSecret("-----BEGIN OPENSSH PRIVATE KEY-----")).toMatch(
      /privada/,
    );
    expect(
      findSecret(
        "commit 3f9a2c1 e https://github.com/Harmony-Digital/hub-gestao/pull/2",
      ),
    ).toBeNull();
  });

  it("recusa a gravação dizendo qual campo", () => {
    expect(() =>
      assertNoSecrets({
        evidence: "token ghp_123456789012345678901234567890AB",
      }),
    ).toThrow(/evidence/);
    expect(() =>
      assertNoSecrets({ title: "Tarefa normal", note: undefined }),
    ).not.toThrow();
  });
});

describe("idempotência: hash do pedido", () => {
  it("ignora a ordem das chaves do JSON", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      '{"a":[2,{"c":4,"d":3}],"b":1}',
    );
    expect(requestHash("post", "/x", { a: 1, b: 2 })).toBe(
      requestHash("POST", "/x", { b: 2, a: 1 }),
    );
    expect(requestHash("POST", "/x", { a: 1 })).not.toBe(
      requestHash("POST", "/x", { a: 2 }),
    );
  });
});

describe("cifra de segredos", () => {
  const key = parseEncryptionKey(Buffer.alloc(32, 7).toString("base64"));

  it("cifra e decifra; cada cifra é diferente", () => {
    const a = encryptSecret("segredo-do-webhook", key);
    const b = encryptSecret("segredo-do-webhook", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("segredo-do-webhook");
  });

  it("recusa chave errada e conteúdo alterado", () => {
    const sealed = encryptSecret("x", key);
    expect(() =>
      decryptSecret(sealed, parseEncryptionKey("ab".repeat(32))),
    ).toThrow();
    // Altera um byte da etiqueta de autenticação: a decifra precisa falhar sempre.
    const [version, iv, tag, data] = sealed.split(".");
    const forged = Buffer.from(tag, "base64url");
    forged[0] ^= 0xff;
    const tampered = [version, iv, forged.toString("base64url"), data].join(
      ".",
    );
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => parseEncryptionKey("curta")).toThrow(/32 bytes/);
  });

  it("assina o webhook com HMAC sobre timestamp e corpo", () => {
    expect(signWebhook("s", "1", "{}")).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signWebhook("s", "1", "{}")).not.toBe(signWebhook("s", "2", "{}"));
  });
});
