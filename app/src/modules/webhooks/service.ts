import { randomBytes } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { encryptSecret } from "@/lib/crypto";
import { encryptionKeyOrNull } from "@/lib/env";
import {
  conflict,
  notFound,
  serverMisconfigured,
  unprocessable,
} from "@/lib/errors";
import { iso, Uuid } from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";
import type { HubEvent } from "@/modules/events";
import { WEBHOOK_EVENTS, type WebhookEvent } from "./events";

/**
 * Webhooks de saída (PRD §8.6): o Hub avisa outros sistemas (o Hermes, que leva ao
 * Telegram do Fábio, ou o n8n) quando algo acontece. Cada aviso vai assinado com o
 * segredo do webhook (HMAC-SHA256 de "timestamp.corpo"); o segredo é gerado pelo Hub,
 * aparece uma vez só, fica cifrado com HUB_ENCRYPTION_KEY e nunca vai para o histórico.
 * Só o dono cadastra, troca o segredo, pausa e testa: é o Hub mandando dados para fora.
 * A entrega é do job webhook-dispatch (no relógio do Hub, de 5 em 5 minutos na VPS, com
 * retentativas).
 */

const MANAGE = "webhook.manage" as const;

export const CreateWebhookInput = z.strictObject({
  url: z
    .string()
    .trim()
    .max(500, "O endereço passou de 500 caracteres.")
    .regex(/^https:\/\/\S+$/, "Use um endereço que comece com https://."),
  events: z
    .array(z.enum(WEBHOOK_EVENTS))
    .min(1, "Marque pelo menos um evento.")
    .max(WEBHOOK_EVENTS.length),
});
export type CreateWebhookInput = z.infer<typeof CreateWebhookInput>;

export type WebhookDelivery = {
  id: string;
  event: string;
  createdAt: string;
  deliveredAt: string | null;
  statusCode: number | null;
  attempts: number;
  lastError: string | null;
};

export type WebhookItem = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  /** Entregas que ainda vão sair (na fila ou esperando nova tentativa). */
  pending: number;
  recent: WebhookDelivery[];
};

const PRIVATE_HOST =
  /^(localhost|.*\.(local|localhost|internal|lan|home|test))$/i;

/** Só endereço público: nada de máquina local, rede interna ou IP privado. */
export function assertPublicUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw unprocessable("Endereço inválido.");
  }
  if (url.protocol !== "https:") {
    throw unprocessable("Use um endereço que comece com https://.");
  }
  if (url.username || url.password) {
    throw unprocessable(
      "O endereço não leva usuário nem senha: a autenticação é a assinatura do Hub.",
    );
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  const privateV4 =
    v4 !== null &&
    (() => {
      const [a, b] = [Number(v4[1]), Number(v4[2])];
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      );
    })();
  const privateV6 =
    host.includes(":") &&
    (host === "::1" ||
      host === "::" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80"));
  if (PRIVATE_HOST.test(host) || privateV4 || privateV6) {
    throw unprocessable(
      "O endereço precisa ser público: o Hub não manda avisos para a rede interna.",
    );
  }
}

function encryptionKey(): Buffer {
  const key = encryptionKeyOrNull();
  if (!key) {
    throw serverMisconfigured(
      "O servidor está sem HUB_ENCRYPTION_KEY: sem ela, o segredo do webhook não pode ser guardado.",
    );
  }
  return key;
}

/** Segredo novo, de 32 bytes, para assinar os avisos. */
const newSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

type Row = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: Date | string;
  pending: number;
};

type DeliveryRow = {
  id: string;
  webhook_id: string;
  event: string;
  created_at: Date | string;
  delivered_at: Date | string | null;
  status_code: number | null;
  attempts: number;
  last_error: string | null;
};

/** Os webhooks do workspace, com as últimas entregas de cada um (só o dono). */
export async function listWebhooks(t: TxCtx): Promise<WebhookItem[]> {
  authorize(t.actor, MANAGE);
  const rows = await many<Row>(
    t,
    `select w.id, w.url, w.events, w.active, w.created_at,
            (select count(*)::int from ${S}.webhook_deliveries d
              where d.webhook_id = w.id and d.delivered_at is null and d.attempts < 8) as pending
       from ${S}.webhooks w
      where w.workspace_id = $1
      order by w.active desc, w.created_at`,
    [t.actor.workspaceId],
  );
  if (rows.length === 0) return [];
  const deliveries = await many<DeliveryRow>(
    t,
    `select id, webhook_id, event, created_at, delivered_at, status_code, attempts, last_error
       from (select d.*, row_number() over (partition by d.webhook_id order by d.created_at desc) as n
               from ${S}.webhook_deliveries d
              where d.webhook_id = any($1::uuid[])) x
      where n <= 5
      order by created_at desc`,
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => ({
    id: r.id,
    url: r.url,
    events: r.events,
    active: r.active,
    createdAt: iso(r.created_at),
    pending: Number(r.pending),
    recent: deliveries
      .filter((d) => d.webhook_id === r.id)
      .map((d) => ({
        id: d.id,
        event: d.event,
        createdAt: iso(d.created_at),
        deliveredAt: d.delivered_at ? iso(d.delivered_at) : null,
        statusCode: d.status_code,
        attempts: d.attempts,
        lastError: d.last_error,
      })),
  }));
}

async function webhookRow(t: TxCtx, id: string): Promise<Row> {
  authorize(t.actor, MANAGE);
  if (!Uuid.safeParse(id).success) throw notFound("Webhook não encontrado.");
  const row = await maybeOne<Row>(
    t,
    `select id, url, events, active, created_at, 0 as pending
       from ${S}.webhooks where id = $1 and workspace_id = $2 for update`,
    [id, t.actor.workspaceId],
  );
  if (!row) throw notFound("Webhook não encontrado.");
  return row;
}

/** Cadastra o webhook. O segredo volta uma vez só, para colar no sistema que recebe. */
export async function createWebhook(
  t: TxCtx,
  raw: z.input<typeof CreateWebhookInput>,
): Promise<{ id: string; secret: string }> {
  authorize(t.actor, MANAGE);
  const input = CreateWebhookInput.parse(raw);
  assertPublicUrl(input.url);
  const taken = await maybeOne(
    t,
    `select 1 from ${S}.webhooks where workspace_id = $1 and url = $2 and active`,
    [t.actor.workspaceId, input.url],
  );
  if (taken) {
    throw conflict(
      "Já existe um webhook ativo com esse endereço: troque o segredo ou mude os eventos dele.",
    );
  }
  const secret = newSecret();
  const events = WEBHOOK_EVENTS.filter((e) => input.events.includes(e));
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.webhooks (workspace_id, url, events, secret_ciphertext)
     values ($1, $2, $3::text[], $4) returning id`,
    [
      t.actor.workspaceId,
      input.url,
      events,
      encryptSecret(secret, encryptionKey()),
    ],
  );
  // O histórico guarda o endereço e os eventos; nunca o segredo.
  await audit(t, {
    action: "webhook.created",
    entityType: "webhook",
    entityId: row!.id,
    after: { url: input.url, events },
  });
  return { id: row!.id, secret };
}

/** Troca o segredo (o antigo para de valer na hora). O novo volta uma vez só. */
export async function rotateWebhookSecret(
  t: TxCtx,
  id: string,
): Promise<{ secret: string }> {
  const row = await webhookRow(t, id);
  const secret = newSecret();
  await t.tx.query(
    `update ${S}.webhooks set secret_ciphertext = $2 where id = $1`,
    [row.id, encryptSecret(secret, encryptionKey())],
  );
  await audit(t, {
    action: "webhook.secret_rotated",
    entityType: "webhook",
    entityId: row.id,
    after: { url: row.url },
  });
  return { secret };
}

/** Pausa (nada sai, nada se acumula) ou reativa. */
export async function setWebhookActive(
  t: TxCtx,
  id: string,
  active: boolean,
): Promise<void> {
  const row = await webhookRow(t, id);
  if (row.active === active) return;
  await t.tx.query(`update ${S}.webhooks set active = $2 where id = $1`, [
    row.id,
    active,
  ]);
  await audit(t, {
    action: active ? "webhook.resumed" : "webhook.paused",
    entityType: "webhook",
    entityId: row.id,
    after: { url: row.url },
  });
}

/** Aviso de teste para um webhook só: sai na próxima volta do relógio, pelo job de entrega. */
export async function sendWebhookTest(
  t: TxCtx,
  id: string,
): Promise<{ deliveryId: string }> {
  const row = await webhookRow(t, id);
  if (!row.active) {
    throw unprocessable("Webhook pausado não recebe teste: reative antes.");
  }
  const event: HubEvent | "webhook.test" = "webhook.test";
  const delivery = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.webhook_deliveries (workspace_id, webhook_id, event, payload, next_attempt_at)
     values ($1, $2, $3, $4::jsonb, now()) returning id`,
    [
      t.actor.workspaceId,
      row.id,
      event,
      json({
        event,
        occurred_at: new Date().toISOString(),
        request_id: t.requestId,
        actor: { type: t.actor.type, id: t.actor.id, name: t.actor.name },
        data: {
          message:
            "Teste do Hub de Gestão: se chegou, a assinatura e o endereço estão certos.",
        },
      }),
    ],
  );
  return { deliveryId: delivery!.id };
}

export type { WebhookEvent };
