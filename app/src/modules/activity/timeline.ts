import { authorize } from "@/lib/authorize";
import { notFound } from "@/lib/errors";
import {
  ACTOR_NAME_SQL,
  actorRef,
  authorizeProjectId,
  iso,
  Uuid,
  type ActorRef,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { describeEntityEvent } from "./timeline-text";

/**
 * Linha do tempo de um marco, uma frente, um projeto ou um cliente (RF-43): os registros
 * do histórico (activity_log, que só cresce) daquela entidade e dos pedidos de aprovação
 * ligados a ela (o aceite do marco, mostrar a frente ao cliente), do mais recente para o
 * mais antigo. Quem vê precisa enxergar a entidade: o projeto dela ou, no cliente, os
 * cadastros.
 */

export type TimelineEntity = "milestone" | "workstream" | "project" | "client";

export type TimelineItem = {
  at: string;
  actor: ActorRef | null;
  /** O papel declarado pelo agente na escrita (AGENTES.md), como GP-01. */
  role: string | null;
  text: string;
  detail: string | null;
};

export type EntityTimeline = {
  type: TimelineEntity;
  id: string;
  /** Como a entidade aparece no título ("M2 · Agente no WhatsApp"). */
  label: string;
  projectCode: string | null;
  /** Para onde voltar: a Visão geral do projeto ou a tela Clientes. */
  backHref: string;
  items: TimelineItem[];
};

export const TIMELINE_LIMIT = 100;

async function resolveEntity(
  t: TxCtx,
  type: TimelineEntity,
  id: string,
): Promise<Omit<EntityTimeline, "items">> {
  if (type === "client") {
    authorize(t.actor, "project.read");
    const c = await maybeOne<{ name: string }>(
      t,
      `select name from ${S}.clients where id = $1`,
      [id],
    );
    if (!c) throw notFound("Cliente não encontrado neste workspace.");
    return {
      type,
      id,
      label: c.name,
      projectCode: null,
      backHref: "/clientes",
    };
  }
  const row = await maybeOne<{
    label: string;
    project_id: string;
    project_code: string;
  }>(
    t,
    type === "milestone"
      ? `select m.code || ' · ' || m.title as label, p.id as project_id, p.code as project_code
           from ${S}.milestones m join ${S}.projects p on p.id = m.project_id
          where m.id = $1`
      : type === "workstream"
        ? `select w.title as label, p.id as project_id, p.code as project_code
             from ${S}.workstreams w join ${S}.projects p on p.id = w.project_id
            where w.id = $1`
        : `select p.code || ' · ' || p.name as label, p.id as project_id, p.code as project_code
             from ${S}.projects p where p.id = $1`,
    [id],
  );
  if (!row) throw notFound("Não encontrado neste workspace.");
  await authorizeProjectId(
    t,
    row.project_id,
    type === "milestone"
      ? "milestone.read"
      : type === "workstream"
        ? "workstream.read"
        : "project.read",
  );
  return {
    type,
    id,
    label: row.label,
    projectCode: row.project_code,
    backHref: `/projetos/${row.project_code}`,
  };
}

export async function entityTimeline(
  t: TxCtx,
  type: TimelineEntity,
  id: string,
): Promise<EntityTimeline> {
  if (!Uuid.safeParse(id).success) throw notFound("Não encontrado.");
  const entity = await resolveEntity(t, type, id);
  const rows = await many<{
    created_at: Date | string;
    action: string;
    actor_type: string;
    actor_id: string | null;
    actor_name: string | null;
    acting_role: string | null;
    after: unknown;
  }>(
    t,
    `select a.created_at, a.action, a.actor_type::text as actor_type, a.actor_id,
            ${ACTOR_NAME_SQL("a.actor_type::text", "a.actor_id")} as actor_name,
            a.acting_role, a.after
       from ${S}.activity_log a
      where (a.entity_type = $1 and a.entity_id = $2)
         or (a.entity_type = 'approval' and a.entity_id in (
               select ap.id from ${S}.approvals ap where ap.entity_id = $2))
      order by a.id desc
      limit ${TIMELINE_LIMIT}`,
    [type, id],
  );
  return {
    ...entity,
    items: rows.map((r) => ({
      at: iso(r.created_at),
      actor: actorRef(r.actor_type, r.actor_id, r.actor_name),
      role: r.acting_role,
      ...describeEntityEvent(r.action, r.after),
    })),
  };
}
