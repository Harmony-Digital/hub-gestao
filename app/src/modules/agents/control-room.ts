import { authorize } from "@/lib/authorize";
import { iso, ProjectCode, projectScopeSql, Uuid } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { describeActivity } from "@/modules/projects/overview";

/**
 * Sala de Controle: o que os agentes fizeram (filtrado por agente e projeto), as recusas de
 * acesso e o gasto de IA do mês. A equipe vê só a atividade dos projetos que enxerga; as
 * recusas não têm projeto e aparecem para toda a equipe interna.
 */

export type FeedItem = {
  id: string;
  at: string;
  agentId: string;
  agent: string;
  /** Papel declarado na escrita (AGENTES.md), como GP-01. */
  role: string | null;
  /** Por onde veio: mcp, api, sync… */
  source: string;
  text: string;
  projectCode: string | null;
  taskCode: string | null;
};

export type DenialItem = {
  id: string;
  at: string;
  agent: string | null;
  source: "api" | "mcp";
  status: 401 | 403 | 423;
  action: string;
  reason: string;
};

export type ControlRoom = {
  kpis: {
    active: number;
    paused: number;
    actions24h: number;
    denials24h: number;
    /** Gasto e soma dos orçamentos de IA do mês, em dólares, dos agentes não revogados. */
    spentMonth: number;
    budgetMonth: number;
  };
  feed: FeedItem[];
  denials: DenialItem[];
  filters: {
    agents: { id: string; name: string }[];
    projects: { code: string; name: string }[];
  };
};

export type ControlRoomFilter = {
  agent: string | null;
  project: string | null;
};

/** Filtro do endereço: valor fora do formato é ignorado. */
export function readControlRoomFilter(query: {
  agente?: string | string[];
  projeto?: string | string[];
}): ControlRoomFilter {
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const agent = one(query.agente);
  const project = one(query.projeto);
  return {
    agent: agent && Uuid.safeParse(agent).success ? agent : null,
    project: project && ProjectCode.safeParse(project).success ? project : null,
  };
}

type FeedRow = {
  id: string;
  created_at: Date | string;
  action: string;
  acting_role: string | null;
  source: string;
  agent_id: string;
  agent_name: string;
  project_code: string | null;
  task_code: string | null;
};

type DenialRow = {
  id: string;
  created_at: Date | string;
  agent_name: string | null;
  source: DenialItem["source"];
  status: number;
  action: string;
  reason: string;
};

const FEED_LIMIT = 50;
const DENIALS_LIMIT = 30;

export async function controlRoom(
  t: TxCtx,
  filter: ControlRoomFilter,
): Promise<ControlRoom> {
  authorize(t.actor, "agent.read");

  const params: unknown[] = [];
  const where = [
    "a.actor_type = 'agent'",
    `(a.project_id is null or ${projectScopeSql(t.actor, "a.project_id", params)})`,
  ];
  if (filter.agent) {
    params.push(filter.agent);
    where.push(`a.actor_id = $${params.length}`);
  }
  if (filter.project) {
    params.push(filter.project);
    where.push(`p.code = $${params.length}`);
  }
  const feed = await many<FeedRow>(
    t,
    `select a.id::text as id, a.created_at, a.action, a.acting_role, a.source,
            ag.id as agent_id, ag.name as agent_name, p.code as project_code,
            coalesce(tk.code, tkc.code) as task_code
       from ${S}.activity_log a
       join ${S}.agents ag on ag.id = a.actor_id
       left join ${S}.projects p on p.id = a.project_id
       left join ${S}.tasks tk on a.entity_type = 'task' and tk.id = a.entity_id
       left join ${S}.comments cm on a.entity_type = 'comment' and cm.id = a.entity_id
       left join ${S}.tasks tkc on cm.entity_type = 'task' and tkc.id = cm.entity_id
      where ${where.join(" and ")}
      order by a.id desc
      limit ${FEED_LIMIT}`,
    params,
  );

  const denials = await many<DenialRow>(
    t,
    `select d.id::text as id, d.created_at, ag.name as agent_name, d.source,
            d.status::int as status, d.action, d.reason
       from ${S}.agent_denials d
       left join ${S}.agents ag on ag.id = d.agent_id
      where d.created_at > now() - interval '30 days'
      order by d.id desc
      limit ${DENIALS_LIMIT}`,
  );

  const countParams: unknown[] = [];
  const counts = await maybeOne<{
    active: number;
    paused: number;
    spent: number;
    budget: number;
    actions: number;
    denials: number;
  }>(
    t,
    `select
       (select count(*)::int from ${S}.agents where status = 'active') as active,
       (select count(*)::int from ${S}.agents where status = 'paused') as paused,
       (select coalesce(sum(spent_usd_month), 0)::float8 from ${S}.agents
         where status <> 'revoked') as spent,
       (select coalesce(sum(budget_usd_month), 0)::float8 from ${S}.agents
         where status <> 'revoked') as budget,
       (select count(*)::int from ${S}.activity_log a
         where a.actor_type = 'agent' and a.created_at > now() - interval '24 hours'
           and (a.project_id is null or ${projectScopeSql(t.actor, "a.project_id", countParams)})) as actions,
       (select count(*)::int from ${S}.agent_denials
         where created_at > now() - interval '24 hours') as denials`,
    countParams,
  );

  const projectParams: unknown[] = [];
  const projects = await many<{ code: string; name: string }>(
    t,
    `select p.code, p.name from ${S}.projects p
      where p.archived_at is null
        and ${projectScopeSql(t.actor, "p.id", projectParams)}
      order by p.code`,
    projectParams,
  );
  const agents = await many<{ id: string; name: string }>(
    t,
    `select id, name from ${S}.agents order by name`,
  );

  return {
    kpis: {
      active: counts?.active ?? 0,
      paused: counts?.paused ?? 0,
      actions24h: counts?.actions ?? 0,
      denials24h: counts?.denials ?? 0,
      spentMonth: Number(counts?.spent ?? 0),
      budgetMonth: Number(counts?.budget ?? 0),
    },
    feed: feed.map((e) => ({
      id: e.id,
      at: iso(e.created_at),
      agentId: e.agent_id,
      agent: e.agent_name,
      role: e.acting_role,
      source: e.source,
      text: describeActivity(e.action, e.task_code),
      projectCode: e.project_code,
      taskCode: e.task_code,
    })),
    denials: denials.map((d) => ({
      id: d.id,
      at: iso(d.created_at),
      agent: d.agent_name,
      source: d.source,
      status: d.status as DenialItem["status"],
      action: d.action,
      reason: d.reason,
    })),
    filters: { agents, projects },
  };
}

/**
 * Marca de mudança da Sala de Controle (atualização ao vivo): muda quando um agente grava,
 * quando alguém mexe num agente ou numa chave e quando há recusa nova.
 */
export async function controlRoomMarker(t: TxCtx): Promise<string> {
  authorize(t.actor, "agent.read");
  const row = await maybeOne<{ activity: string; denial: string }>(
    t,
    `select
       (select coalesce(max(id), 0)::text from ${S}.activity_log
         where actor_type = 'agent' or entity_type in ('agent', 'agent_key')) as activity,
       (select coalesce(max(id), 0)::text from ${S}.agent_denials) as denial`,
  );
  return `${row?.activity ?? 0}.${row?.denial ?? 0}`;
}
