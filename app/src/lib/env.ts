import "server-only";
import { assertPepper } from "@/lib/agent-keys";
import { parseEncryptionKey } from "@/lib/crypto";
import { serverMisconfigured } from "@/lib/errors";

/**
 * Configuração do servidor, lida do ambiente a cada uso. Segredos ficam em
 * .env.local (local) ou /opt/hub-gestao/shared/.env.production (VPS); nunca no código.
 */
export type ServerEnv = {
  nodeEnv: string;
  appVersion: string;
  workspaceSlug: string;
  databaseUrl: string | null;
  dbRuntimeRole: string | null;
  dataDir: string;
  devAgentKey: string | null;
  rateLimitPerMinute: number;
};

export function serverEnv(): ServerEnv {
  const e = process.env;
  const rate = Number(e.HUB_RATE_LIMIT_PER_MIN ?? "600");
  return {
    nodeEnv: e.NODE_ENV ?? "development",
    appVersion: e.APP_VERSION?.trim() || "local",
    workspaceSlug: e.HUB_WORKSPACE_SLUG?.trim() || "harmony",
    databaseUrl: e.DATABASE_URL?.trim() || null,
    dbRuntimeRole: e.HUB_DB_RUNTIME_ROLE?.trim() || null,
    dataDir: e.HUB_DATA_DIR?.trim() || ".data/pglite",
    devAgentKey: e.HUB_DEV_AGENT_KEY?.trim() || null,
    rateLimitPerMinute: Number.isFinite(rate) && rate > 0 ? rate : 600,
  };
}

/** Pepper das chaves de agente. Sem ele o Hub recusa autenticar (fail-closed). */
export function apiKeyPepper(): string {
  try {
    return assertPepper(process.env.HUB_API_KEY_PEPPER);
  } catch {
    throw serverMisconfigured(
      "O servidor está sem HUB_API_KEY_PEPPER válido; nenhuma chave de agente é aceita até isso ser corrigido.",
    );
  }
}

/** Chave de cifra dos segredos guardados no banco; null quando não configurada. */
export function encryptionKeyOrNull(): Buffer | null {
  try {
    return parseEncryptionKey(process.env.HUB_ENCRYPTION_KEY);
  } catch {
    return null;
  }
}

/** Segredo dos webhooks do GitHub (32 caracteres ou mais); sem ele, o webhook recusa tudo. */
export function githubWebhookSecret(): string | null {
  const value = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

export function cronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}
