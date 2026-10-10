import { can } from "@/lib/authorize";
import { iso, projectScopeSql } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { describeActivity } from "@/modules/projects/overview";
import { today, type TodayDto } from "./service";

/**
 * Painel "Hoje" das pessoas (PRD RF-24): a fila do dia (`today`) mais o que a tela
 * mostra ao redor dela. Tudo por regra e dentro do escopo de quem vê; nada por IA.
 */

export type CockpitProject = {
  code: string;
  name: string;
  health: "healthy" | "attention" | "at_risk";
  /** Motivos da saúde, gravados pela regra (PRD §5.7). */
  reasons: string[];
};

/** Uma ação de agente nas últimas 24 horas, já com o verbo em PT-BR. */
export type AgentEvent = {
  at: string;
  agent: string;
  /** Código do papel declarado na escrita (AGENTES.md), como GP-01. */
  role: string | null;
  text: string;
  projectCode: string | null;
  taskCode: string | null;
};

export type Cockpit = TodayDto & {
  /** Quem vê pode decidir as aprovações (owner, D9)? */
  canDecide: boolean;
  projects: CockpitProject[];
  agentEvents: AgentEvent[];
  /** Tarefas concluídas por agentes desde a meia-noite (fuso do workspace). */
  doneByAgentsToday: number;
};

type ProjectRow = {
  code: string;
  name: string;
  health: CockpitProject["health"];
  health_reason: { reasons?: unknown } | null;
};

type EventRow = {
  created_at: Date | string;
  action: string;
  acting_role: string | null;
  agent_name: string;
  project_code: string | null;
  task_code: string | null;
};

export async function cockpit(t: TxCtx): Promise<Cockpit> {
  // today() confere o acesso e já aplica o escopo de quem vê.
  const base = await today(t);

  const projectParams: unknown[] = [];
  const projects = can(t.actor, "project.read")
    ? await many<ProjectRow>(
        t,
        `select p.code, p.name, p.health::text as health, p.health_reason
           from ${S}.projects p
          where p.archived_at is null
            and p.status in ('active', 'discovery', 'in_review')
            and ${projectScopeSql(t.actor, "p.id", projectParams)}
          order by case p.health when 'at_risk' then 0 when 'attention' then 1 else 2 end,
                   p.name`,
        projectParams,
      )
    : [];

  let agentEvents: EventRow[] = [];
  let doneByAgentsToday = 0;
  if (can(t.actor, "agent.read")) {
    const eventParams: unknown[] = [];
    agentEvents = await many<EventRow>(
      t,
      `select a.created_at, a.action, a.acting_role, ag.name as agent_name,
              p.code as project_code, coalesce(tk.code, tkc.code) as task_code
         from ${S}.activity_log a
         join ${S}.agents ag on ag.id = a.actor_id
         left join ${S}.projects p on p.id = a.project_id
         left join ${S}.tasks tk on a.entity_type = 'task' and tk.id = a.entity_id
         left join ${S}.comments cm on a.entity_type = 'comment' and cm.id = a.entity_id
         left join ${S}.tasks tkc on cm.entity_type = 'task' and tkc.id = cm.entity_id
        where a.actor_type = 'agent' and a.created_at > now() - interval '24 hours'
          and (a.project_id is null or ${projectScopeSql(t.actor, "a.project_id", eventParams)})
        order by a.id desc
        limit 12`,
      eventParams,
    );
    const doneParams: unknown[] = [];
    // current_date segue o fuso do workspace, ajustado em cada transação (withActor).
    doneByAgentsToday =
      (
        await maybeOne<{ n: number }>(
          t,
          `select count(*)::int as n
             from ${S}.activity_log a
            where a.actor_type = 'agent' and a.action = 'task.completed'
              and a.created_at >= current_date
              and ${projectScopeSql(t.actor, "a.project_id", doneParams)}`,
          doneParams,
        )
      )?.n ?? 0;
  }

  return {
    ...base,
    canDecide: can(t.actor, "approval.decide"),
    projects: projects.map((p) => ({
      code: p.code,
      name: p.name,
      health: p.health,
      reasons: Array.isArray(p.health_reason?.reasons)
        ? (p.health_reason.reasons as unknown[]).filter(
            (r): r is string => typeof r === "string",
          )
        : [],
    })),
    agentEvents: agentEvents.map((e) => ({
      at: iso(e.created_at),
      agent: e.agent_name,
      role: e.acting_role,
      text: describeActivity(e.action, e.task_code),
      projectCode: e.project_code,
      taskCode: e.task_code,
    })),
    doneByAgentsToday,
  };
}
