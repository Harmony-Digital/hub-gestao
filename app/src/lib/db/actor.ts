import type { Db, Queryable } from "./types";

export type WorkspaceRole = "owner" | "admin" | "member";

type Base = { workspaceId: string; name: string; actingRole?: string };

/** Pessoa da equipe Harmony. */
export type UserActor = Base & {
  type: "user";
  id: string;
  scope: "internal";
  role: WorkspaceRole;
};

/** Contato de cliente no portal (D9): só vê o que é do cliente e está marcado para ele. */
export type ClientActor = Base & {
  type: "user";
  id: string;
  scope: "client";
  clientId: string;
  contactRole: "client_viewer" | "client_approver";
};

/** Agente de IA autenticado por chave própria. */
export type AgentActor = Base & {
  type: "agent";
  id: string;
  scope: "internal";
  keyId: string;
  kind: "hermes" | "internal" | "session" | "integration";
  scopes: string[];
  /** null = todos os projetos do workspace (só com o escopo workspace:*). */
  projectIds: string[] | null;
  roles: string[];
};

/** Rotinas do próprio Hub (cron, recálculos). */
export type SystemActor = Base & {
  type: "system";
  id: null;
  scope: "internal";
};

export type Actor = UserActor | ClientActor | AgentActor | SystemActor;

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Abre uma transação com o contexto do ator. As políticas de RLS do schema leem esse
 * contexto; sem ele, nada aparece (fail-closed).
 */
export async function withActor<T>(
  db: Db,
  actor: Actor,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    if (db.runtimeRole) {
      if (!ROLE_NAME.test(db.runtimeRole)) {
        throw new Error("Papel de banco inválido na configuração.");
      }
      await tx.query(`set local role ${db.runtimeRole}`);
    }
    await tx.query(
      `select set_config('hub.workspace_id', $1, true),
              set_config('hub.actor_type', $2, true),
              set_config('hub.actor_id', $3, true),
              set_config('hub.actor_scope', $4, true),
              set_config('hub.client_id', $5, true)`,
      [
        actor.workspaceId,
        actor.type,
        actor.id ?? "",
        actor.scope,
        actor.scope === "client" ? actor.clientId : "",
      ],
    );
    return fn(tx);
  });
}
