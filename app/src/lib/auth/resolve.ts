import {
  applyRuntimeRole,
  type UserActor,
  type WorkspaceRole,
} from "@/lib/db/actor";
import type { Db } from "@/lib/db/types";

/** Pessoa da equipe com sessão válida e acesso ao workspace. */
export type HubUser = {
  actor: UserActor;
  fullName: string;
  email: string;
  /** true no primeiro login, quando o usuário do Supabase Auth foi ligado ao perfil. */
  linkedNow: boolean;
};

export type AuthIdentity = {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
};

type Row = {
  profile_id: string;
  full_name: string;
  email: string;
  workspace_id: string;
  role: WorkspaceRole;
  linked_now: boolean;
};

/**
 * Quem é, no Hub, o usuário já conferido no Supabase Auth. Sem perfil ativo e vínculo
 * ativo com o workspace, devolve null e nada no Hub fica acessível.
 * Regras e registro no histórico: migration hub_gestao_0010_auth_login.sql.
 */
export async function resolveHubUser(
  db: Db,
  identity: AuthIdentity,
  workspaceSlug: string,
): Promise<HubUser | null> {
  const rows = await db.transaction(async (tx) => {
    await applyRuntimeRole(db, tx);
    return (
      await tx.query<Row>(
        `select profile_id, full_name, email, workspace_id, role, linked_now
           from proj_hub_gestao.profile_for_auth_user($1, $2, $3, $4)`,
        [identity.id, identity.email, identity.emailConfirmed, workspaceSlug],
      )
    ).rows;
  });
  const row = rows[0];
  if (!row) return null;
  return {
    actor: {
      type: "user",
      id: row.profile_id,
      scope: "internal",
      role: row.role,
      workspaceId: row.workspace_id,
      name: row.full_name,
    },
    fullName: row.full_name,
    email: row.email,
    linkedNow: row.linked_now,
  };
}
