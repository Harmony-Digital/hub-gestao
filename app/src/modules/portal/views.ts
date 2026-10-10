import { forbidden } from "@/lib/errors";
import type { Actor } from "@/lib/db/actor";
import { many, S, type TxCtx } from "@/modules/context";

/**
 * Leituras do portal do cliente (D9). Rodam com o ator de cliente: a RLS só devolve os
 * projetos do cliente (fora de revisão e não arquivados) e os marcos marcados para ele.
 * Cada leitura escolhe os campos um a um (DTO do portal): nada de campo interno, nem
 * texto interno no lugar do texto para o cliente.
 */

export function assertClient(actor: Actor): void {
  if (actor.scope !== "client") {
    throw forbidden("Esta leitura é só do portal do cliente.");
  }
}

export type PortalProject = {
  code: string;
  name: string;
  phase: "descobrir" | "validar" | "escalar";
  objective: string | null;
  progressPct: number;
  targetDate: string | null;
  nextMilestone: { title: string; dueDate: string | null } | null;
};

type ProjectRow = {
  id: string;
  code: string;
  name: string;
  phase: PortalProject["phase"];
  objective_client: string | null;
  progress_pct: number;
  target_date: string | null;
};

type MilestoneRow = {
  project_id: string;
  title_client: string | null;
  due_date: string | null;
};

/** Os projetos do cliente, com o próximo marco para ele (o primeiro ainda não entregue). */
export async function portalProjects(t: TxCtx): Promise<PortalProject[]> {
  assertClient(t.actor);
  const projects = await many<ProjectRow>(
    t,
    `select p.id, p.code, p.name, p.phase::text as phase, p.objective_client,
            p.progress_pct, p.target_date::text as target_date
       from ${S}.projects p
      order by p.name`,
  );
  if (projects.length === 0) return [];
  const next = await many<MilestoneRow>(
    t,
    `select distinct on (m.project_id) m.project_id, m.title_client,
            m.due_date::text as due_date
       from ${S}.milestones m
      where m.project_id = any($1::uuid[])
        and m.status not in ('delivered', 'accepted')
        and m.title_client is not null
      order by m.project_id, m.sort_order, m.code`,
    [projects.map((p) => p.id)],
  );
  return projects.map((p) => {
    const m = next.find((n) => n.project_id === p.id);
    return {
      code: p.code,
      name: p.name,
      phase: p.phase,
      objective: p.objective_client,
      progressPct: Number(p.progress_pct),
      targetDate: p.target_date,
      nextMilestone: m?.title_client
        ? { title: m.title_client, dueDate: m.due_date }
        : null,
    };
  });
}
