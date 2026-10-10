import { z } from "zod";
import { audit } from "@/lib/audit";
import { conflict, notFound, unprocessable, badRequest } from "@/lib/errors";
import {
  authorizeProjectId,
  Line,
  resolveProject,
  Uuid,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import {
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABEL,
  type StatusCategory,
} from "./status-categories";

export { STATUS_CATEGORIES, STATUS_CATEGORY_LABEL, type StatusCategory };

/**
 * Status de tarefa de cada projeto, sobre as cinco categorias fixas (a categoria decide o
 * comportamento: concluir pede evidência, bloquear pede o motivo, a saúde conta as
 * bloqueadas). Quem cuida é o dono ou a administração. A categoria não muda depois de
 * criada (a tarefa guarda a categoria do status); para trocar, crie outro status e mova.
 */

const ADMIN = "workspace.admin" as const;
const MAX_STATUSES = 15;
const Color = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Cor em hexadecimal, como #3B6FB6.");

export type StatusAdminItem = {
  id: string;
  name: string;
  color: string;
  category: StatusCategory;
  isDefault: boolean;
  /** Tarefas neste status (inclui as concluídas e as arquivadas). */
  tasks: number;
};

type StatusRow = {
  id: string;
  name: string;
  color: string;
  category: StatusCategory;
  is_default: boolean;
  sort_order: number;
  project_id: string;
  tasks: number;
};

const SELECT = `
  select s.id, s.name, s.color, s.category::text as category, s.is_default, s.sort_order,
         s.project_id,
         (select count(*)::int from ${S}.tasks t where t.status_id = s.id) as tasks
    from ${S}.task_statuses s`;

function toItem(r: StatusRow): StatusAdminItem {
  return {
    id: r.id,
    name: r.name,
    color: r.color.toUpperCase(),
    category: r.category,
    isDefault: r.is_default,
    tasks: Number(r.tasks),
  };
}

export async function projectStatusesAdmin(
  t: TxCtx,
  projectCode: string,
): Promise<StatusAdminItem[]> {
  const project = await resolveProject(t, projectCode, "project.read");
  const rows = await many<StatusRow>(
    t,
    `${SELECT} where s.project_id = $1 order by s.sort_order, s.name`,
    [project.id],
  );
  return rows.map(toItem);
}

async function nameTaken(
  t: TxCtx,
  projectId: string,
  name: string,
  exceptId: string | null,
): Promise<boolean> {
  return Boolean(
    await maybeOne(
      t,
      `select 1 from ${S}.task_statuses
        where project_id = $1 and lower(name) = lower($2) and ($3::uuid is null or id <> $3)`,
      [projectId, name, exceptId],
    ),
  );
}

export const CreateStatusInput = z.strictObject({
  name: Line(40),
  category: z.enum(STATUS_CATEGORIES),
  color: Color,
});

export async function createStatus(
  t: TxCtx,
  projectCode: string,
  raw: z.input<typeof CreateStatusInput>,
): Promise<StatusAdminItem> {
  const project = await resolveProject(t, projectCode, ADMIN);
  const input = CreateStatusInput.parse(raw);
  const total = await maybeOne<{ n: number; last: number | null }>(
    t,
    `select count(*)::int as n, max(sort_order) as last
       from ${S}.task_statuses where project_id = $1`,
    [project.id],
  );
  if ((total?.n ?? 0) >= MAX_STATUSES) {
    throw unprocessable(`Cada projeto tem até ${MAX_STATUSES} status.`);
  }
  if (await nameTaken(t, project.id, input.name, null)) {
    throw conflict(`Já existe o status "${input.name}" neste projeto.`);
  }
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.task_statuses (workspace_id, project_id, name, color, category, sort_order)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      t.actor.workspaceId,
      project.id,
      input.name,
      input.color.toUpperCase(),
      input.category,
      (total?.last ?? 0) + 1,
    ],
  );
  await audit(t, {
    action: "status.created",
    entityType: "project",
    entityId: project.id,
    projectId: project.id,
    after: { name: input.name, category: input.category },
  });
  const created = await maybeOne<StatusRow>(t, `${SELECT} where s.id = $1`, [
    row!.id,
  ]);
  return toItem(created!);
}

/** Status com o projeto dele, conferindo que quem age cuida do projeto. */
async function lockStatus(t: TxCtx, id: string): Promise<StatusRow> {
  if (!Uuid.safeParse(id).success) throw badRequest("Status inválido.");
  const row = await maybeOne<StatusRow>(
    t,
    `${SELECT} where s.id = $1 for update of s`,
    [id],
  );
  if (!row) throw notFound("Status não encontrado.");
  await authorizeProjectId(t, row.project_id, ADMIN);
  return row;
}

export const UpdateStatusInput = z.strictObject({
  name: Line(40).optional(),
  color: Color.optional(),
  /** Status em que a tarefa nova começa (só da categoria A fazer). */
  make_default: z.literal(true).optional(),
});

/** Renomeia, troca a cor ou torna padrão. Devolve os campos que mudaram. */
export async function updateStatus(
  t: TxCtx,
  id: string,
  raw: z.input<typeof UpdateStatusInput>,
): Promise<string[]> {
  const row = await lockStatus(t, id);
  const input = UpdateStatusInput.parse(raw);
  const changed: string[] = [];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (input.name !== undefined && input.name !== row.name) {
    if (await nameTaken(t, row.project_id, input.name, row.id)) {
      throw conflict(`Já existe o status "${input.name}" neste projeto.`);
    }
    await t.tx.query(`update ${S}.task_statuses set name = $2 where id = $1`, [
      row.id,
      input.name,
    ]);
    changed.push("name");
    before.name = row.name;
    after.name = input.name;
  }
  const color = input.color?.toUpperCase();
  if (color !== undefined && color !== row.color.toUpperCase()) {
    await t.tx.query(`update ${S}.task_statuses set color = $2 where id = $1`, [
      row.id,
      color,
    ]);
    changed.push("color");
    before.color = row.color.toUpperCase();
    after.color = color;
  }
  if (input.make_default && !row.is_default) {
    if (row.category !== "todo") {
      throw unprocessable(
        'Só um status da categoria "A fazer" pode ser o padrão das tarefas novas.',
      );
    }
    await t.tx.query(
      `update ${S}.task_statuses set is_default = false where project_id = $1 and is_default`,
      [row.project_id],
    );
    await t.tx.query(
      `update ${S}.task_statuses set is_default = true where id = $1`,
      [row.id],
    );
    changed.push("default");
    after.default = after.name ?? row.name;
  }
  if (changed.length > 0) {
    await audit(t, {
      action: "status.updated",
      entityType: "project",
      entityId: row.project_id,
      projectId: row.project_id,
      before: { ...before, status: row.name },
      after,
    });
  }
  return changed;
}

/** Nova ordem dos status do projeto (todos, na ordem em que aparecem). */
export async function reorderStatuses(
  t: TxCtx,
  projectCode: string,
  ids: string[],
): Promise<number> {
  const project = await resolveProject(t, projectCode, ADMIN);
  const rows = await many<{ id: string; sort_order: number; name: string }>(
    t,
    `select id, sort_order, name from ${S}.task_statuses
      where project_id = $1 for update`,
    [project.id],
  );
  const known = new Set(rows.map((r) => r.id));
  if (
    ids.length !== rows.length ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => known.has(id))
  ) {
    throw unprocessable(
      "A nova ordem precisa ter todos os status do projeto, uma vez cada. Recarregue a página.",
    );
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  let changed = 0;
  for (const [i, id] of ids.entries()) {
    if (byId.get(id)!.sort_order === i + 1) continue;
    await t.tx.query(
      `update ${S}.task_statuses set sort_order = $2 where id = $1`,
      [id, i + 1],
    );
    changed += 1;
  }
  if (changed > 0) {
    await audit(t, {
      action: "statuses.reordered",
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
      after: { order: ids.map((id) => byId.get(id)!.name) },
    });
  }
  return changed;
}

/**
 * Remove um status. Se houver tarefas nele, elas vão para `moveTo`, da mesma categoria.
 * Cada categoria fica com pelo menos um status, e o padrão não sai sem outro no lugar.
 */
export async function removeStatus(
  t: TxCtx,
  id: string,
  moveTo?: string,
): Promise<void> {
  const row = await lockStatus(t, id);
  const sameCategory = await many<{ id: string; name: string }>(
    t,
    `select id, name from ${S}.task_statuses
      where project_id = $1 and category = $2 and id <> $3`,
    [row.project_id, row.category, row.id],
  );
  if (sameCategory.length === 0) {
    throw unprocessable(
      `"${row.name}" é o único status da categoria ${STATUS_CATEGORY_LABEL[row.category]}: crie outro antes de remover.`,
    );
  }
  if (row.is_default) {
    throw unprocessable(
      `"${row.name}" é o status padrão das tarefas novas: escolha outro padrão antes de remover.`,
    );
  }
  let target: { id: string; name: string } | null = null;
  if (row.tasks > 0) {
    target = sameCategory.find((s) => s.id === moveTo) ?? null;
    if (!target) {
      throw unprocessable(
        `"${row.name}" tem ${row.tasks} ${row.tasks === 1 ? "tarefa" : "tarefas"}: escolha para qual status de ${STATUS_CATEGORY_LABEL[row.category]} elas vão.`,
      );
    }
    await t.tx.query(
      `update ${S}.tasks set status_id = $2 where status_id = $1`,
      [row.id, target.id],
    );
  }
  await t.tx.query(`delete from ${S}.task_statuses where id = $1`, [row.id]);
  await audit(t, {
    action: "status.removed",
    entityType: "project",
    entityId: row.project_id,
    projectId: row.project_id,
    before: { name: row.name, category: row.category },
    after: target ? { moved_to: target.name, tasks: row.tasks } : null,
  });
}
