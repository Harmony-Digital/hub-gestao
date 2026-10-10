import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { badRequest, conflict, notFound, unprocessable } from "@/lib/errors";
import {
  authorizeProjectId,
  iso,
  projectScopeSql,
  resolveProject,
  Uuid,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { emitEvent, recomputeRollup } from "@/modules/events";

/**
 * Arquivar e restaurar (M3): marco, frente, projeto e cliente. Nada é apagado: o item
 * sai das listas, do Hoje e do portal do cliente e volta inteiro ao ser restaurado.
 * As travas evitam deixar algo pendurado (frente ligada a marco arquivado, pedido de
 * aceite sem dono, cliente arquivado com projeto ativo). Projeto arquivado vira só
 * leitura para pessoas e agentes (regra central em resolveProject/authorizeProjectId).
 */

const ADMIN = "workspace.admin" as const;

/** "“A”, “B” e mais 2": nomes curtos para as mensagens de trava. */
function namesList(names: string[], max = 3): string {
  const shown = names.slice(0, max).map((n) => `“${n}”`);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} e mais ${rest}` : shown.join(", ");
}

function checkId(id: string, what: string): void {
  if (!Uuid.safeParse(id).success) throw badRequest(`${what} inválido.`);
}

// Marco -------------------------------------------------------------------------------

type MilestoneLock = {
  project_id: string;
  code: string;
  status: string;
  archived_at: Date | string | null;
};

async function lockMilestone(t: TxCtx, id: string): Promise<MilestoneLock> {
  checkId(id, "Marco");
  const row = await maybeOne<MilestoneLock>(
    t,
    `select project_id, code, status, archived_at from ${S}.milestones where id = $1 for update`,
    [id],
  );
  if (!row) throw notFound("Marco não encontrado neste workspace.");
  return row;
}

export async function archiveMilestone(
  t: TxCtx,
  id: string,
): Promise<{ code: string }> {
  const m = await lockMilestone(t, id);
  await authorizeProjectId(t, m.project_id, "milestone.write");
  if (m.archived_at) throw conflict(`O ${m.code} já está arquivado.`);
  if (m.status === "accepted") {
    throw unprocessable(
      `O ${m.code} foi aceito e fica no histórico do projeto: marco aceito não é arquivado.`,
    );
  }
  const pending = await maybeOne<{ id: string }>(
    t,
    `select id from ${S}.approvals
      where type = 'milestone_acceptance' and status = 'pending' and entity_id = $1`,
    [id],
  );
  if (pending) {
    throw conflict(
      `Há um pedido de aceite do ${m.code} esperando decisão. Decida o pedido em Aprovações antes de arquivar.`,
      { approval_id: pending.id },
    );
  }
  const linked = await many<{ title: string }>(
    t,
    `select title from ${S}.workstreams
      where milestone_id = $1 and archived_at is null order by sort_order, title`,
    [id],
  );
  if (linked.length > 0) {
    throw unprocessable(
      `O ${m.code} tem frentes ligadas: ${namesList(linked.map((w) => w.title))}. Mude o marco dessas frentes ou arquive-as antes.`,
    );
  }
  await t.tx.query(
    `update ${S}.milestones set archived_at = now() where id = $1`,
    [id],
  );
  await audit(t, {
    action: "milestone.archived",
    entityType: "milestone",
    entityId: id,
    projectId: m.project_id,
    after: { code: m.code },
  });
  return { code: m.code };
}

export async function restoreMilestone(
  t: TxCtx,
  id: string,
): Promise<{ code: string }> {
  const m = await lockMilestone(t, id);
  // Em projeto arquivado, a regra central pede para restaurar o projeto antes.
  await authorizeProjectId(t, m.project_id, "milestone.write");
  if (!m.archived_at) throw conflict(`O ${m.code} não está arquivado.`);
  await t.tx.query(
    `update ${S}.milestones set archived_at = null where id = $1`,
    [id],
  );
  await audit(t, {
    action: "milestone.restored",
    entityType: "milestone",
    entityId: id,
    projectId: m.project_id,
    after: { code: m.code },
  });
  return { code: m.code };
}

// Frente ------------------------------------------------------------------------------

type WorkstreamLock = {
  project_id: string;
  project_code: string;
  title: string;
  visibility: string;
  archived_at: Date | string | null;
  milestone_code: string | null;
  milestone_archived_at: Date | string | null;
};

async function lockWorkstream(t: TxCtx, id: string): Promise<WorkstreamLock> {
  checkId(id, "Frente");
  const row = await maybeOne<WorkstreamLock>(
    t,
    `select w.project_id, p.code as project_code, w.title, w.visibility, w.archived_at,
            m.code as milestone_code, m.archived_at as milestone_archived_at
       from ${S}.workstreams w
       join ${S}.projects p on p.id = w.project_id
       left join ${S}.milestones m on m.id = w.milestone_id
      where w.id = $1
      for update of w`,
    [id],
  );
  if (!row) throw notFound("Frente não encontrada neste workspace.");
  return row;
}

/** Frente que o cliente vê: tirar ou devolver ao portal é decisão de quem decide. */
async function authorizeWorkstream(t: TxCtx, w: WorkstreamLock): Promise<void> {
  await authorizeProjectId(t, w.project_id, "workstream.write");
  if (w.visibility === "client") {
    await authorizeProjectId(t, w.project_id, "workstream.visibility");
  }
}

export async function archiveWorkstream(
  t: TxCtx,
  id: string,
): Promise<{ title: string }> {
  const w = await lockWorkstream(t, id);
  await authorizeWorkstream(t, w);
  if (w.archived_at) throw conflict(`A frente “${w.title}” já está arquivada.`);
  const open = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.tasks
      where workstream_id = $1 and archived_at is null and status_category <> 'done'`,
    [id],
  );
  if (open && open.n > 0) {
    throw unprocessable(
      `A frente “${w.title}” tem ${open.n === 1 ? "1 tarefa aberta" : `${open.n} tarefas abertas`}. Conclua as tarefas ou mude-as de frente antes de arquivar.`,
    );
  }
  await t.tx.query(
    `update ${S}.workstreams set archived_at = now() where id = $1`,
    [id],
  );
  await recomputeRollup(t, w.project_id);
  await audit(t, {
    action: "workstream.archived",
    entityType: "workstream",
    entityId: id,
    projectId: w.project_id,
    after: { title: w.title },
  });
  await emitEvent(t, "workstream.updated", {
    id,
    project_code: w.project_code,
    archived: true,
  });
  return { title: w.title };
}

export async function restoreWorkstream(
  t: TxCtx,
  id: string,
): Promise<{ title: string }> {
  const w = await lockWorkstream(t, id);
  await authorizeWorkstream(t, w);
  if (!w.archived_at) {
    throw conflict(`A frente “${w.title}” não está arquivada.`);
  }
  if (w.milestone_archived_at) {
    throw unprocessable(
      `O marco ${w.milestone_code} desta frente está arquivado. Restaure o marco antes.`,
    );
  }
  await t.tx.query(
    `update ${S}.workstreams set archived_at = null where id = $1`,
    [id],
  );
  await recomputeRollup(t, w.project_id);
  await audit(t, {
    action: "workstream.restored",
    entityType: "workstream",
    entityId: id,
    projectId: w.project_id,
    after: { title: w.title },
  });
  await emitEvent(t, "workstream.updated", {
    id,
    project_code: w.project_code,
    archived: false,
  });
  return { title: w.title };
}

// Projeto -----------------------------------------------------------------------------

/** Status para onde um projeto restaurado pode voltar. */
const RESTORABLE = new Set([
  "in_review",
  "discovery",
  "active",
  "paused",
  "delivered",
]);

export async function archiveProject(
  t: TxCtx,
  code: string,
): Promise<{ code: string }> {
  // Já arquivado para aqui: a regra central só deixa ler.
  const ref = await resolveProject(t, code, ADMIN);
  await t.tx.query(`select 1 from ${S}.projects where id = $1 for update`, [
    ref.id,
  ]);
  const pending = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.approvals
      where project_id = $1 and status = 'pending'`,
    [ref.id],
  );
  if (pending && pending.n > 0) {
    throw unprocessable(
      `O ${ref.code} tem ${pending.n === 1 ? "1 pedido esperando" : `${pending.n} pedidos esperando`} decisão em Aprovações. Decida antes de arquivar.`,
    );
  }
  await t.tx.query(
    `update ${S}.projects set status = 'archived', archived_at = now() where id = $1`,
    [ref.id],
  );
  await audit(t, {
    action: "project.archived",
    entityType: "project",
    entityId: ref.id,
    projectId: ref.id,
    before: { status: ref.status },
    after: { status: "archived" },
  });
  return { code: ref.code };
}

export async function restoreProject(
  t: TxCtx,
  code: string,
): Promise<{ code: string; status: string }> {
  const ref = await resolveProject(t, code, "project.read");
  authorize(t.actor, ADMIN);
  const row = await maybeOne<{
    status: string;
    client_name: string;
    client_archived_at: Date | string | null;
  }>(
    t,
    `select p.status, c.name as client_name, c.archived_at as client_archived_at
       from ${S}.projects p
       join ${S}.clients c on c.id = p.client_id
      where p.id = $1
      for update of p`,
    [ref.id],
  );
  if (!row || row.status !== "archived") {
    throw conflict(`O projeto ${ref.code} não está arquivado.`);
  }
  if (row.client_archived_at) {
    throw unprocessable(
      `O cliente ${row.client_name} está arquivado. Restaure o cliente antes, na tela Clientes.`,
    );
  }
  // Volta ao status de antes de arquivar, lido do histórico; sem registro, Pausado.
  const last = await maybeOne<{ status: string | null }>(
    t,
    `select before ->> 'status' as status from ${S}.activity_log
      where entity_type = 'project' and entity_id = $1 and action = 'project.archived'
      order by id desc limit 1`,
    [ref.id],
  );
  const status =
    last?.status && RESTORABLE.has(last.status) ? last.status : "paused";
  await t.tx.query(
    `update ${S}.projects set status = $2::${S}.project_status, archived_at = null where id = $1`,
    [ref.id, status],
  );
  await audit(t, {
    action: "project.restored",
    entityType: "project",
    entityId: ref.id,
    projectId: ref.id,
    before: { status: "archived" },
    after: { status },
  });
  return { code: ref.code, status };
}

// Cliente -----------------------------------------------------------------------------

async function lockClient(
  t: TxCtx,
  id: string,
): Promise<{ name: string; archived_at: Date | string | null }> {
  authorize(t.actor, ADMIN);
  checkId(id, "Cliente");
  const row = await maybeOne<{
    name: string;
    archived_at: Date | string | null;
  }>(t, `select name, archived_at from ${S}.clients where id = $1 for update`, [
    id,
  ]);
  if (!row) throw notFound("Cliente não encontrado neste workspace.");
  return row;
}

export async function archiveClient(
  t: TxCtx,
  id: string,
): Promise<{ name: string }> {
  const c = await lockClient(t, id);
  if (c.archived_at) throw conflict(`O cliente ${c.name} já está arquivado.`);
  const projects = await many<{ code: string }>(
    t,
    `select code from ${S}.projects
      where client_id = $1 and archived_at is null order by code`,
    [id],
  );
  if (projects.length > 0) {
    throw unprocessable(
      `O cliente ${c.name} tem projetos ativos: ${projects.map((p) => p.code).join(", ")}. Arquive os projetos antes.`,
    );
  }
  await t.tx.query(
    `update ${S}.clients set archived_at = now() where id = $1`,
    [id],
  );
  await audit(t, {
    action: "client.archived",
    entityType: "client",
    entityId: id,
    after: { name: c.name },
  });
  return { name: c.name };
}

export async function restoreClient(
  t: TxCtx,
  id: string,
): Promise<{ name: string }> {
  const c = await lockClient(t, id);
  if (!c.archived_at) throw conflict(`O cliente ${c.name} não está arquivado.`);
  await t.tx.query(`update ${S}.clients set archived_at = null where id = $1`, [
    id,
  ]);
  await audit(t, {
    action: "client.restored",
    entityType: "client",
    entityId: id,
    after: { name: c.name },
  });
  return { name: c.name };
}

// Listas do que está arquivado ---------------------------------------------------------

export type ArchivedInProject = {
  milestones: {
    id: string;
    code: string;
    title: string;
    archived_at: string;
  }[];
  workstreams: {
    id: string;
    title: string;
    milestone_code: string | null;
    archived_at: string;
  }[];
};

/** Marcos e frentes arquivados de um projeto (para restaurar na Visão geral). */
export async function archivedInProject(
  t: TxCtx,
  projectId: string,
): Promise<ArchivedInProject> {
  await authorizeProjectId(t, projectId, "project.read");
  const milestones = await many<{
    id: string;
    code: string;
    title: string;
    archived_at: Date | string;
  }>(
    t,
    `select id, code, title, archived_at from ${S}.milestones
      where project_id = $1 and archived_at is not null
      order by archived_at desc`,
    [projectId],
  );
  const workstreams = await many<{
    id: string;
    title: string;
    milestone_code: string | null;
    archived_at: Date | string;
  }>(
    t,
    `select w.id, w.title, m.code as milestone_code, w.archived_at
       from ${S}.workstreams w
       left join ${S}.milestones m on m.id = w.milestone_id
      where w.project_id = $1 and w.archived_at is not null
      order by w.archived_at desc`,
    [projectId],
  );
  return {
    milestones: milestones.map((m) => ({
      ...m,
      archived_at: iso(m.archived_at),
    })),
    workstreams: workstreams.map((w) => ({
      ...w,
      archived_at: iso(w.archived_at),
    })),
  };
}

export type ArchivedProject = {
  code: string;
  name: string;
  client_name: string;
  archived_at: string;
};

/** Projetos arquivados que o ator enxerga (member, só os dele). */
export async function archivedProjects(t: TxCtx): Promise<ArchivedProject[]> {
  authorize(t.actor, "project.read");
  const params: unknown[] = [];
  const rows = await many<
    Omit<ArchivedProject, "archived_at"> & {
      archived_at: Date | string;
    }
  >(
    t,
    `select p.code, p.name, c.name as client_name, p.archived_at
       from ${S}.projects p
       join ${S}.clients c on c.id = p.client_id
      where p.archived_at is not null and ${projectScopeSql(t.actor, "p.id", params)}
      order by p.archived_at desc`,
    params,
  );
  return rows.map((r) => ({ ...r, archived_at: iso(r.archived_at) }));
}

export type ArchivedClient = {
  id: string;
  name: string;
  segment: string | null;
  archived_at: string;
};

export async function archivedClients(t: TxCtx): Promise<ArchivedClient[]> {
  authorize(t.actor, "project.read");
  const rows = await many<
    Omit<ArchivedClient, "archived_at"> & {
      archived_at: Date | string;
    }
  >(
    t,
    `select id, name, segment, archived_at from ${S}.clients
      where archived_at is not null order by archived_at desc`,
  );
  return rows.map((r) => ({ ...r, archived_at: iso(r.archived_at) }));
}
