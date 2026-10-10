import { applyRuntimeRole } from "@/lib/db/actor";
import type { Db } from "@/lib/db/types";
import { toHubError } from "@/lib/errors";
import { log } from "@/lib/log";
import { S } from "@/modules/context";

/**
 * Recusas de acesso dos agentes, para a Sala de Controle: sem permissão (403), agente
 * pausado (423) e chave revogada ou vencida (401). A transação que falhou é desfeita,
 * então o registro sai por fora, pela função `record_agent_denial` (migração 0012). Chave
 * desconhecida não é registrada. Registrar nunca derruba a resposta ao agente.
 */

export type DenialSource = "api" | "mcp";

/** Quem tentou, quando a chave existe (vem da busca da chave ou do agente autenticado). */
export type DenialWho = {
  workspaceId: string;
  agentId: string;
  keyPrefix: string | null;
};

const knownKey = new WeakMap<object, DenialWho>();

/** Marca a recusa da autenticação com a chave conhecida (revogada, vencida, pausada). */
export function withDenialWho<E extends object>(err: E, who: DenialWho): E {
  knownKey.set(err, who);
  return err;
}

export function denialWhoOf(err: unknown): DenialWho | null {
  return err && typeof err === "object" ? (knownKey.get(err) ?? null) : null;
}

/** Status que a Sala de Controle mostra como recusa de acesso. */
export const RECORDED_DENIALS: ReadonlySet<number> = new Set([401, 403, 423]);
const WINDOW_MS = 60_000;
const recent = new Map<string, number>();

/** No máximo um registro por minuto para o mesmo agente, recusa e ação. */
export function claimDenial(key: string, now = Date.now()): boolean {
  const last = recent.get(key);
  if (last !== undefined && now - last < WINDOW_MS) return false;
  recent.set(key, now);
  if (recent.size > 5_000) {
    for (const [k, at] of recent) if (now - at >= WINDOW_MS) recent.delete(k);
  }
  return true;
}

/** Registra a recusa, se for uma das que a Sala de Controle mostra. */
export async function recordDenial(
  db: Db,
  who: DenialWho | null,
  source: DenialSource,
  action: string,
  err: unknown,
): Promise<void> {
  const e = toHubError(err);
  if (!who || !RECORDED_DENIALS.has(e.status)) return;
  if (!claimDenial(`${who.agentId}|${e.status}|${action}`)) return;
  try {
    await db.transaction(async (tx) => {
      await applyRuntimeRole(db, tx);
      await tx.query(
        `select ${S}.record_agent_denial($1, $2, $3, $4, $5, $6, $7)`,
        [
          who.workspaceId,
          who.agentId,
          who.keyPrefix,
          source,
          e.status,
          action,
          e.detail,
        ],
      );
    });
  } catch (failure) {
    log.warn(
      { cause: (failure as Error)?.message?.slice(0, 200) },
      "falha ao registrar recusa de agente",
    );
  }
}
