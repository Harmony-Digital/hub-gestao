import { applyRuntimeRole } from "./actor";
import type { Db } from "./types";

/**
 * Conferência de partida do banco de produção (fail-closed): o papel com que o servidor
 * roda as consultas precisa obedecer à RLS. Superusuário, papel com BYPASSRLS ou dono das
 * tabelas do Hub passam por cima das regras de acesso; nesses casos o Hub não abre.
 */
export async function assertRlsEnforced(db: Db): Promise<void> {
  const row = await db.transaction(async (tx) => {
    await applyRuntimeRole(db, tx);
    return (
      await tx.query<{ role: string; bypass: boolean; owned: number }>(
        `select current_user::text as role,
                (r.rolsuper or r.rolbypassrls) as bypass,
                (select count(*)::int from pg_catalog.pg_tables t
                  where t.schemaname = 'proj_hub_gestao' and t.tableowner = current_user) as owned
           from pg_catalog.pg_roles r
          where r.rolname = current_user`,
      )
    ).rows[0];
  });
  if (!row || row.bypass || row.owned > 0) {
    throw new Error(
      `O papel de banco "${row?.role ?? "desconhecido"}" passa por cima das regras de acesso (RLS) do Hub. Configure DATABASE_URL e HUB_DB_RUNTIME_ROLE com o papel próprio do Hub.`,
    );
  }
}
