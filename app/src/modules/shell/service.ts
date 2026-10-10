import { can } from "@/lib/authorize";
import { projectScopeSql } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { unreadCount } from "@/modules/notifications";

/** O que a barra lateral mostra além dos links. Uma consulta leve por tela. */
export type ShellData = {
  /** Aprovações esperando decisão (só para quem decide; os demais veem 0). */
  pendingDecisions: number;
  /** Até 4 projetos ativos, primeiro os que pedem atenção. */
  featured: { code: string; name: string; health: string }[];
  /** Agentes com alguma ação registrada nas últimas 24 horas. */
  agentsActive24h: number;
  /** Avisos sem ler na caixa de entrada de quem está vendo. */
  unread: number;
};

export async function shellData(t: TxCtx): Promise<ShellData> {
  const decides = can(t.actor, "approval.decide");
  const pending = decides
    ? await maybeOne<{ n: number }>(
        t,
        `select count(*)::int as n from ${S}.approvals where status = 'pending'`,
      )
    : null;

  const scopeParams: unknown[] = [];
  const featured = can(t.actor, "project.read")
    ? await many<{ code: string; name: string; health: string }>(
        t,
        `select p.code, p.name, p.health::text as health
           from ${S}.projects p
          where p.archived_at is null
            and p.status in ('active', 'discovery', 'in_review')
            and ${projectScopeSql(t.actor, "p.id", scopeParams)}
          order by case p.health when 'at_risk' then 0 when 'attention' then 1 else 2 end,
                   p.updated_at desc
          limit 4`,
        scopeParams,
      )
    : [];

  const agents = can(t.actor, "agent.read")
    ? await maybeOne<{ n: number }>(
        t,
        `select count(distinct a.actor_id)::int as n
           from ${S}.activity_log a
          where a.actor_type = 'agent' and a.created_at > now() - interval '24 hours'`,
      )
    : null;

  return {
    pendingDecisions: pending?.n ?? 0,
    featured,
    agentsActive24h: agents?.n ?? 0,
    unread: await unreadCount(t),
  };
}
