import { createHash } from "node:crypto";
import { badRequest, conflict } from "@/lib/errors";
import { S, type TxCtx } from "@/modules/context";

/**
 * Idempotência (AGENTS.md §7.5): mesma Idempotency-Key com o mesmo corpo devolve a
 * mesma resposta; com corpo diferente, 409. A reserva da chave, a mudança e a resposta
 * guardada ficam na mesma transação: se a ação falhar, nada fica guardado e o agente
 * pode tentar de novo com a mesma chave.
 */

export type StoredResponse = { status: number; body: unknown };

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

export function assertIdempotencyKey(key: string | null | undefined): string {
  if (!key) {
    throw badRequest(
      "Envie o cabeçalho Idempotency-Key (8 a 200 caracteres) em toda escrita. Use um valor novo por ação, como um UUID.",
    );
  }
  if (!KEY_PATTERN.test(key)) {
    throw badRequest(
      "Idempotency-Key inválida: use de 8 a 200 caracteres entre letras, números, ponto, dois-pontos, hífen e sublinhado.",
    );
  }
  return key;
}

/** JSON com chaves em ordem, para que o mesmo corpo gere sempre o mesmo hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    .join(",")}}`;
}

export function requestHash(
  method: string,
  target: string,
  body: unknown,
): string {
  return createHash("sha256")
    .update(`${method.toUpperCase()} ${target}\n${canonicalJson(body)}`)
    .digest("hex");
}

export async function withIdempotency(
  t: TxCtx,
  key: string,
  hash: string,
  run: () => Promise<StoredResponse>,
): Promise<{ replayed: boolean; response: StoredResponse }> {
  const actorId = t.actor.id;
  if (!actorId) {
    // Rotinas do sistema não usam idempotência por chave.
    return { replayed: false, response: await run() };
  }

  const reserved = await t.tx.query(
    `insert into ${S}.idempotency_keys
       (workspace_id, actor_id, key, request_hash, response_status, response_body)
     values ($1, $2, $3, $4, 0, '{}'::jsonb)
     on conflict (actor_id, key) do nothing
     returning key`,
    [t.actor.workspaceId, actorId, key, hash],
  );

  if (reserved.rows.length === 0) {
    const previous = (
      await t.tx.query<{
        request_hash: string;
        response_status: number;
        response_body: unknown;
        expired: boolean;
      }>(
        `select request_hash, response_status, response_body, expires_at < now() as expired
           from ${S}.idempotency_keys where actor_id = $1 and key = $2`,
        [actorId, key],
      )
    ).rows[0];

    if (previous && !previous.expired) {
      if (previous.request_hash !== hash) {
        throw conflict(
          "Esta Idempotency-Key já foi usada com outro pedido. Gere uma chave nova para uma ação nova.",
          { idempotency_key: key },
        );
      }
      return {
        replayed: true,
        response: {
          status: previous.response_status,
          body: previous.response_body,
        },
      };
    }

    // Chave vencida (mais de 24 horas): vale como nova.
    await t.tx.query(
      `update ${S}.idempotency_keys
          set request_hash = $3, response_status = 0, response_body = '{}'::jsonb,
              created_at = now(), expires_at = now() + interval '24 hours'
        where actor_id = $1 and key = $2`,
      [actorId, key, hash],
    );
  }

  const response = await run();
  await t.tx.query(
    `update ${S}.idempotency_keys
        set response_status = $3, response_body = $4::jsonb
      where actor_id = $1 and key = $2`,
    [actorId, key, response.status, JSON.stringify(response.body ?? null)],
  );
  return { replayed: false, response };
}
