import { authorize } from "@/lib/authorize";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Preparação do portal de um cliente (OB-13, AGENTES.md): o que já está pronto para o
 * cliente ver e o que falta, contado direto do banco, sem IA. Mostra o que a equipe
 * precisa fazer antes (ou depois) de liberar o acesso: contatos, objetivo escrito para o
 * cliente em cada projeto, entregas com o título para ele, acesso liberado e o aceite do
 * uso dos dados. Só a equipe de administração lê (a mesma tela dos contatos).
 */

export type ReadinessProject = {
  code: string;
  name: string;
  /** O objetivo escrito para o cliente (sem ele, o portal não mostra objetivo). */
  hasClientObjective: boolean;
  /** Entregas que aparecem no portal (marcadas para o cliente e com o título para ele). */
  clientMilestones: number;
  /** Marcadas para o cliente, mas sem o título para ele: não aparecem. */
  milestonesWithoutText: number;
  /** Frentes que aparecem no portal. */
  clientWorkstreams: number;
};

export type PortalReadiness = {
  contacts: number;
  released: number;
  consented: number;
  projects: ReadinessProject[];
};

export async function portalReadiness(
  t: TxCtx,
  clientId: string,
): Promise<PortalReadiness> {
  authorize(t.actor, "workspace.admin");
  const people = await maybeOne<{
    contacts: number;
    released: number;
    consented: number;
  }>(
    t,
    `select count(*)::int as contacts,
            count(*) filter (where access_status in ('invited', 'active'))::int as released,
            count(*) filter (where consent_at is not null and access_status = 'active')::int as consented
       from ${S}.client_contacts where client_id = $1`,
    [clientId],
  );
  const projects = await many<{
    code: string;
    name: string;
    has_objective: boolean;
    client_milestones: number;
    without_text: number;
    client_workstreams: number;
  }>(
    t,
    `select p.code, p.name,
            (coalesce(btrim(p.objective_client), '') <> '') as has_objective,
            (select count(*)::int from ${S}.milestones m
              where m.project_id = p.id and m.visibility = 'client'
                and m.archived_at is null and m.title_client is not null) as client_milestones,
            (select count(*)::int from ${S}.milestones m
              where m.project_id = p.id and m.visibility = 'client'
                and m.archived_at is null and m.title_client is null) as without_text,
            (select count(*)::int from ${S}.workstreams w
              where w.project_id = p.id and w.visibility = 'client'
                and w.archived_at is null) as client_workstreams
       from ${S}.projects p
      where p.client_id = $1 and p.status not in ('in_review', 'archived')
      order by p.name`,
    [clientId],
  );
  return {
    contacts: people?.contacts ?? 0,
    released: people?.released ?? 0,
    consented: people?.consented ?? 0,
    projects: projects.map((p) => ({
      code: p.code,
      name: p.name,
      hasClientObjective: p.has_objective,
      clientMilestones: Number(p.client_milestones),
      milestonesWithoutText: Number(p.without_text),
      clientWorkstreams: Number(p.client_workstreams),
    })),
  };
}
