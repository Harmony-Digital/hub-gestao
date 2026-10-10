import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { encryptionKeyOrNull } from "@/lib/env";
import {
  conflict,
  notFound,
  serverMisconfigured,
  unprocessable,
} from "@/lib/errors";
import { iso, Line, Uuid } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { LLM_PROVIDERS, PROVIDER_LABEL, type LlmProvider } from "./providers";

/**
 * Chaves de IA do workspace (decisão D5): uma por provedor e conta, cifradas com
 * AES-256-GCM (HUB_ENCRYPTION_KEY) e mostradas só pelos 4 últimos caracteres. Cadastrar,
 * trocar e revogar é só do dono; a lista (sem a chave) é da administração. A chave nunca
 * volta para o navegador, nunca vai para o histórico nem para o log; quem a lê é só o
 * adaptador de IA, no servidor, na hora da chamada.
 */

export { LLM_PROVIDERS, PROVIDER_LABEL, type LlmProvider };

export type CredentialItem = {
  id: string;
  provider: LlmProvider;
  label: string;
  last4: string;
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
  /** Agentes que usam esta chave. */
  agents: number;
};

/** A chave: uma linha, sem espaços, de 20 a 300 caracteres. */
const ApiKey = z
  .string()
  .trim()
  .min(20, "A chave parece curta demais: cole a chave inteira.")
  .max(300, "A chave passou de 300 caracteres.")
  .regex(/^\S+$/, "A chave não tem espaços nem quebras de linha.");

export const CreateCredentialInput = z.strictObject({
  provider: z.enum(LLM_PROVIDERS),
  label: Line(80),
  key: ApiKey,
});

function encryptionKey(): Buffer {
  const key = encryptionKeyOrNull();
  if (!key) {
    throw serverMisconfigured(
      "O servidor está sem HUB_ENCRYPTION_KEY: sem ela, as chaves de IA não podem ser guardadas.",
    );
  }
  return key;
}

const last4 = (key: string) => key.slice(-4);

type Row = {
  id: string;
  provider: LlmProvider;
  label: string;
  key_last4: string;
  created_at: Date | string;
  rotated_at: Date | string | null;
  revoked_at: Date | string | null;
  created_by: string | null;
  agents: number;
};

const SELECT = `
  select c.id, c.provider::text as provider, c.label, c.key_last4, c.created_at,
         c.rotated_at, c.revoked_at, p.full_name as created_by,
         (select count(*)::int from ${S}.agents a where a.llm_credential_id = c.id) as agents
    from ${S}.llm_credentials c
    left join ${S}.profiles p on p.id = c.created_by_profile_id`;

function toItem(r: Row): CredentialItem {
  return {
    id: r.id,
    provider: r.provider,
    label: r.label,
    last4: r.key_last4,
    createdAt: iso(r.created_at),
    rotatedAt: r.rotated_at ? iso(r.rotated_at) : null,
    revokedAt: r.revoked_at ? iso(r.revoked_at) : null,
    createdBy: r.created_by,
    agents: Number(r.agents),
  };
}

/** Lista das chaves (sem a chave): dono e administração. */
export async function listCredentials(t: TxCtx): Promise<CredentialItem[]> {
  authorize(t.actor, "agent.manage");
  const rows = await many<Row>(
    t,
    `${SELECT} order by c.revoked_at nulls first, c.provider, c.label`,
  );
  return rows.map(toItem);
}

export async function createCredential(
  t: TxCtx,
  raw: z.input<typeof CreateCredentialInput>,
): Promise<CredentialItem> {
  authorize(t.actor, "agent.keys");
  const input = CreateCredentialInput.parse(raw);
  const taken = await maybeOne(
    t,
    `select 1 from ${S}.llm_credentials
      where workspace_id = $1 and lower(label) = lower($2) and revoked_at is null`,
    [t.actor.workspaceId, input.label],
  );
  if (taken) {
    throw conflict(`Já existe uma chave ativa com o nome "${input.label}".`);
  }
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.llm_credentials
       (workspace_id, provider, label, key_ciphertext, key_last4, created_by_profile_id)
     values ($1, $2::${S}.llm_provider, $3, $4, $5, $6)
     returning id`,
    [
      t.actor.workspaceId,
      input.provider,
      input.label,
      encryptSecret(input.key, encryptionKey()),
      last4(input.key),
      t.actor.type === "user" ? t.actor.id : null,
    ],
  );
  // O histórico guarda o provedor, o nome e os 4 últimos; nunca a chave.
  await audit(t, {
    action: "llm_credential.created",
    entityType: "llm_credential",
    entityId: row!.id,
    after: {
      provider: input.provider,
      label: input.label,
      last4: last4(input.key),
    },
  });
  return (await credentialById(t, row!.id))!;
}

async function lockCredential(t: TxCtx, id: string): Promise<Row> {
  authorize(t.actor, "agent.keys");
  if (!Uuid.safeParse(id).success) throw notFound("Chave não encontrada.");
  const row = await maybeOne<Row>(
    t,
    `${SELECT} where c.id = $1 for update of c`,
    [id],
  );
  if (!row) throw notFound("Chave não encontrada.");
  return row;
}

/** Troca a chave (mesmo nome e provedor); os agentes que a usam passam a usar a nova. */
export async function rotateCredential(
  t: TxCtx,
  id: string,
  rawKey: string,
): Promise<CredentialItem> {
  const row = await lockCredential(t, id);
  if (row.revoked_at) {
    throw unprocessable("Chave revogada não é trocada: cadastre uma nova.");
  }
  const key = ApiKey.parse(rawKey);
  await t.tx.query(
    `update ${S}.llm_credentials
        set key_ciphertext = $2, key_last4 = $3, rotated_at = now()
      where id = $1`,
    [id, encryptSecret(key, encryptionKey()), last4(key)],
  );
  await audit(t, {
    action: "llm_credential.rotated",
    entityType: "llm_credential",
    entityId: id,
    before: { last4: row.key_last4 },
    after: { last4: last4(key) },
  });
  return (await credentialById(t, id))!;
}

/** Revoga: a chave para de ser usada na hora (agentes caem no modo sem IA). */
export async function revokeCredential(
  t: TxCtx,
  id: string,
): Promise<CredentialItem> {
  const row = await lockCredential(t, id);
  if (row.revoked_at) return toItem(row);
  await t.tx.query(
    `update ${S}.llm_credentials set revoked_at = now() where id = $1`,
    [id],
  );
  await audit(t, {
    action: "llm_credential.revoked",
    entityType: "llm_credential",
    entityId: id,
    before: { label: row.label, last4: row.key_last4 },
  });
  return (await credentialById(t, id))!;
}

async function credentialById(
  t: TxCtx,
  id: string,
): Promise<CredentialItem | null> {
  const row = await maybeOne<Row>(t, `${SELECT} where c.id = $1`, [id]);
  return row ? toItem(row) : null;
}

/**
 * A chave em claro, só para o adaptador de IA no servidor (nunca para a tela, para a API
 * ou para o log). Chave revogada ou inexistente: null (o adaptador cai no modo sem IA).
 */
export async function credentialSecret(
  t: TxCtx,
  id: string,
): Promise<{ provider: LlmProvider; key: string } | null> {
  const row = await maybeOne<{
    provider: LlmProvider;
    key_ciphertext: string;
  }>(
    t,
    `select provider::text as provider, key_ciphertext from ${S}.llm_credentials
      where id = $1 and revoked_at is null`,
    [id],
  );
  if (!row) return null;
  return {
    provider: row.provider,
    key: decryptSecret(row.key_ciphertext, encryptionKey()),
  };
}
