import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Chaves de agente: `hub_ak_<prefixo>.<segredo>` (PRD §8.2).
 * O prefixo identifica a chave no banco; só o hash (HMAC-SHA256 com o pepper do
 * servidor) fica guardado. O valor completo aparece uma única vez, na criação.
 */

export const KEY_PREFIX_TAG = "hub_ak_";
const PREFIX_BODY_LENGTH = 12;
const SECRET_BYTES = 32;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const KEY_PATTERN = /^(hub_ak_[a-z0-9]{8,16})\.([A-Za-z0-9_-]{32,128})$/;

export const MIN_PEPPER_LENGTH = 32;

/** Todos os escopos que uma chave de agente pode ter (PRD §8.2). */
export const AGENT_SCOPES = [
  "projects:read",
  "milestones:read",
  "tasks:read",
  "agents:read",
  "tasks:write",
  "tasks:complete",
  "workstreams:write",
  "comments:write",
  "approvals:request",
  "reports:draft",
  "time:write",
  "sync:plan",
  "projects:import",
  "workspace:*",
] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

/** Escopos que nenhum agente recebe, nem com autorização (PRD §8.2). */
export const FORBIDDEN_AGENT_SCOPES = [
  "approvals:decide",
  "portal:read",
  "portal:write",
  "agents:keys",
] as const;

export function isAgentScope(value: string): value is AgentScope {
  return (AGENT_SCOPES as readonly string[]).includes(value);
}

function randomAlphanumeric(length: number): string {
  // Amostragem por rejeição: só bytes abaixo de 252 (múltiplo de 36), sem viés.
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 252) out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function assertPepper(pepper: string | undefined): string {
  if (!pepper || pepper.length < MIN_PEPPER_LENGTH) {
    throw new Error(
      `HUB_API_KEY_PEPPER ausente ou curto: são necessários ${MIN_PEPPER_LENGTH} caracteres ou mais.`,
    );
  }
  return pepper;
}

export function hashAgentKey(key: string, pepper: string): string {
  return createHmac("sha256", assertPepper(pepper)).update(key).digest("hex");
}

export type GeneratedKey = { key: string; prefix: string; hash: string };

export function generateAgentKey(pepper: string): GeneratedKey {
  const prefix = KEY_PREFIX_TAG + randomAlphanumeric(PREFIX_BODY_LENGTH);
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const key = `${prefix}.${secret}`;
  return { key, prefix, hash: hashAgentKey(key, pepper) };
}

export function parseAgentKey(
  raw: string,
): { key: string; prefix: string } | null {
  const match = KEY_PATTERN.exec(raw.trim());
  if (!match) return null;
  return { key: match[0], prefix: match[1] };
}

/** Comparação em tempo constante entre o hash calculado e o guardado. */
export function verifyAgentKey(
  key: string,
  storedHash: string,
  pepper: string,
): boolean {
  const computed = Buffer.from(hashAgentKey(key, pepper), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

/** Lê `Authorization: Bearer <chave>`. Devolve null se o cabeçalho não tiver esse formato. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}
