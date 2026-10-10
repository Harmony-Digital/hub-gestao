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
  /** Prefixo público da chave (hub_ak_…), para registros; o segredo nunca. */
  keyPrefix?: string;
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

/** Troca para o papel de banco do app (sem passe livre na RLS), se configurado. */
export async function applyRuntimeRole(db: Db, tx: Queryable): Promise<void> {
  if (!db.runtimeRole) return;
  if (!ROLE_NAME.test(db.runtimeRole)) {
    throw new Error("Papel de banco inválido na configuração.");
  }
  await tx.query(`set local role ${db.runtimeRole}`);
}

/**
 * Abre uma transação com o contexto do ator. As políticas de RLS do schema leem esse
 * contexto; sem ele, nada aparece (fail-closed). O fuso da transação passa a ser o do
 * workspace, para que "hoje" no banco seja o dia de quem usa o Hub.
 */
export async function withActor<T>(
  db: Db,
  actor: Actor,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await applyRuntimeRole(db, tx);
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
    await tx.query(
      `select set_config('TimeZone', w.timezone, true)
         from proj_hub_gestao.workspaces w where w.id = $1`,
      [actor.workspaceId],
    );
    return fn(tx);
  });
}
