import { audit } from "@/lib/audit";
import { badRequest, conflict, notFound, unprocessable } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import {
  authorizeProjectId,
  Line,
  resolveProject,
  TaskCode,
  Uuid,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import type { TaskDto } from "./schemas";
import { lockTask } from "./service";

/**
 * Checklist e dependências da tarefa (painel lateral, M3). Mudanças passam pela
 * permissão de escrita no projeto da tarefa e ficam no histórico dela.
 */

// Checklist ---------------------------------------------------------------------------

export type ChecklistItemDto = {
  id: string;
  text: string;
  done: boolean;
  sort_order: number;
};

const MAX_ITEMS = 50;

export async function checklistOf(
  t: TxCtx,
  taskId: string,
): Promise<ChecklistItemDto[]> {
  return many<ChecklistItemDto>(
    t,
    `select id, text, done, sort_order from ${S}.checklist_items
      where task_id = $1 order by sort_order, created_at`,
    [taskId],
  );
}

function itemText(value: string): string {
  const parsed = Line(300).safeParse(value);
  if (!parsed.success) {
    throw badRequest(
      "Cada item do checklist tem de 1 a 300 caracteres, numa linha só.",
    );
  }
  assertNoSecrets({ text: parsed.data });
  return parsed.data;
}

export async function addChecklistItem(
  t: TxCtx,
  code: string,
  text: string,
): Promise<ChecklistItemDto> {
  const task = await lockTask(t, code, "task.write");
  const value = itemText(text);
  const current = await maybeOne<{ n: number; next: number }>(
    t,
    `select count(*)::int as n, coalesce(max(sort_order), 0) + 1 as next
       from ${S}.checklist_items where task_id = $1`,
    [task.id],
  );
  if (current!.n >= MAX_ITEMS) {
    throw unprocessable(
      `O checklist de ${task.code} já tem ${MAX_ITEMS} itens. Quebre o trabalho em subtarefas.`,
    );
  }
  const item = await maybeOne<ChecklistItemDto>(
    t,
    `insert into ${S}.checklist_items (workspace_id, task_id, text, sort_order)
     values ($1, $2, $3, $4)
     returning id, text, done, sort_order`,
    [t.actor.workspaceId, task.id, value, current!.next],
  );
  await audit(t, {
    action: "checklist.added",
    entityType: "task",
    entityId: task.id,
    projectId: task.project_id,
    after: { text: value },
  });
  return item!;
}

type LockedItem = {
  id: string;
  task_id: string;
  text: string;
  done: boolean;
  project_id: string;
};

async function lockItem(t: TxCtx, id: string): Promise<LockedItem> {
  if (!Uuid.safeParse(id).success) {
    throw badRequest("Item de checklist inválido.");
  }
  const row = await maybeOne<LockedItem>(
    t,
    `select c.id, c.task_id, c.text, c.done, tk.project_id
       from ${S}.checklist_items c
       join ${S}.tasks tk on tk.id = c.task_id
      where c.id = $1 and tk.archived_at is null
      for update of c`,
    [id],
  );
  if (!row) throw notFound("Item de checklist não encontrado.");
  await authorizeProjectId(t, row.project_id, "task.write");
  return row;
}

/** Marca, desmarca ou renomeia um item; o que não mudou não vai para o histórico. */
export async function updateChecklistItem(
  t: TxCtx,
  id: string,
  input: { text?: string; done?: boolean },
): Promise<ChecklistItemDto> {
  const item = await lockItem(t, id);
  const text = input.text !== undefined ? itemText(input.text) : item.text;
  const done = input.done ?? item.done;
  if (text !== item.text || done !== item.done) {
    await t.tx.query(
      `update ${S}.checklist_items set text = $2, done = $3 where id = $1`,
      [id, text, done],
    );
    const entry = {
      entityType: "task",
      entityId: item.task_id,
      projectId: item.project_id,
    };
    if (text !== item.text) {
      await audit(t, {
        ...entry,
        action: "checklist.renamed",
        before: { text: item.text },
        after: { text },
      });
    }
    if (done !== item.done) {
      await audit(t, {
        ...entry,
        action: done ? "checklist.checked" : "checklist.unchecked",
        after: { text },
      });
    }
  }
  const row = await maybeOne<ChecklistItemDto>(
    t,
    `select id, text, done, sort_order from ${S}.checklist_items where id = $1`,
    [id],
  );
  return row!;
}

export async function removeChecklistItem(t: TxCtx, id: string): Promise<void> {
  const item = await lockItem(t, id);
  await t.tx.query(`delete from ${S}.checklist_items where id = $1`, [id]);
  await audit(t, {
    action: "checklist.removed",
    entityType: "task",
    entityId: item.task_id,
    projectId: item.project_id,
    after: { text: item.text },
  });
}

// Dependências ------------------------------------------------------------------------

export type DependencyRef = {
  code: string;
  title: string;
  status_name: string;
  status_category: TaskDto["status"]["category"];
};

/** A tarefa depende de `blocked_by` e segura as de `blocks`. */
export type TaskDependencies = {
  blocked_by: DependencyRef[];
  blocks: DependencyRef[];
};

const MAX_DEPENDENCIES = 20;

const REF_SELECT = `select tk.code, tk.title, st.name as status_name,
                           tk.status_category::text as status_category
                      from ${S}.task_dependencies d`;

export async function dependenciesOf(
  t: TxCtx,
  taskId: string,
): Promise<TaskDependencies> {
  // Na tabela, a linha (task_id = A, blocks_task_id = B) quer dizer "A segura B".
  const blockedBy = await many<DependencyRef>(
    t,
    `${REF_SELECT}
       join ${S}.tasks tk on tk.id = d.task_id
       join ${S}.task_statuses st on st.id = tk.status_id
      where d.blocks_task_id = $1 and tk.archived_at is null
      order by tk.code`,
    [taskId],
  );
  const blocks = await many<DependencyRef>(
    t,
    `${REF_SELECT}
       join ${S}.tasks tk on tk.id = d.blocks_task_id
       join ${S}.task_statuses st on st.id = tk.status_id
      where d.task_id = $1 and tk.archived_at is null
      order by tk.code`,
    [taskId],
  );
  return { blocked_by: blockedBy, blocks };
}

async function otherTask(
  t: TxCtx,
  code: string,
): Promise<{ id: string; code: string }> {
  const parsed = TaskCode.safeParse(code.trim().toUpperCase());
  if (!parsed.success) {
    throw badRequest("Informe o código da tarefa, como HUB-12.");
  }
  const row = await maybeOne<{ id: string; code: string; project_id: string }>(
    t,
    `select id, code, project_id from ${S}.tasks where code = $1 and archived_at is null`,
    [parsed.data],
  );
  if (!row) throw notFound(`Tarefa ${parsed.data} não encontrada.`);
  await authorizeProjectId(t, row.project_id, "task.read");
  return row;
}

/** `code` passa a depender de `blockedBy`. Recusa a si mesma e ciclos. */
export async function addDependency(
  t: TxCtx,
  code: string,
  blockedBy: string,
): Promise<void> {
  const task = await lockTask(t, code, "task.write");
  const blocker = await otherTask(t, blockedBy);
  if (blocker.id === task.id) {
    throw badRequest(`${task.code} não pode depender de si mesma.`);
  }
  const existing = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.task_dependencies where blocks_task_id = $1`,
    [task.id],
  );
  if (existing!.n >= MAX_DEPENDENCIES) {
    throw unprocessable(
      `${task.code} já depende de ${MAX_DEPENDENCIES} tarefas. Revise as dependências antes de somar outra.`,
    );
  }
  const already = await maybeOne<{ found: number }>(
    t,
    `select 1 as found from ${S}.task_dependencies where task_id = $1 and blocks_task_id = $2`,
    [blocker.id, task.id],
  );
  if (already) {
    throw conflict(`${task.code} já depende de ${blocker.code}.`);
  }
  // Ciclo: se a tarefa já segura (direta ou indiretamente) a outra, a ligação fecharia o laço.
  const cycle = await maybeOne<{ found: number }>(
    t,
    `with recursive held(id) as (
       select blocks_task_id from ${S}.task_dependencies where task_id = $1
       union
       select d.blocks_task_id from ${S}.task_dependencies d join held h on d.task_id = h.id
     )
     select 1 as found from held where id = $2 limit 1`,
    [task.id, blocker.id],
  );
  if (cycle) {
    throw unprocessable(
      `${blocker.code} já depende de ${task.code} (direta ou indiretamente): a ligação fecharia um ciclo.`,
    );
  }
  await t.tx.query(
    `insert into ${S}.task_dependencies (workspace_id, task_id, blocks_task_id) values ($1, $2, $3)`,
    [t.actor.workspaceId, blocker.id, task.id],
  );
  await audit(t, {
    action: "dependency.added",
    entityType: "task",
    entityId: task.id,
    projectId: task.project_id,
    after: { blocked_by: blocker.code },
  });
}

export async function removeDependency(
  t: TxCtx,
  code: string,
  blockedBy: string,
): Promise<void> {
  const task = await lockTask(t, code, "task.write");
  const blocker = await otherTask(t, blockedBy);
  const removed = await maybeOne<{ found: number }>(
    t,
    `delete from ${S}.task_dependencies where task_id = $1 and blocks_task_id = $2 returning 1 as found`,
    [blocker.id, task.id],
  );
  if (!removed) {
    throw notFound(`${task.code} não depende de ${blocker.code}.`);
  }
  await audit(t, {
    action: "dependency.removed",
    entityType: "task",
    entityId: task.id,
    projectId: task.project_id,
    after: { blocked_by: blocker.code },
  });
}

// Ordem no quadro ---------------------------------------------------------------------

/**
 * Grava a ordem de uma coluna do quadro: as tarefas recebem posições 1024, 2048… na
 * ordem dada. Só as que mudam de lugar são gravadas, e o projeto ganha um registro só.
 */
export async function reorderTasks(
  t: TxCtx,
  projectCode: string,
  codes: string[],
): Promise<number> {
  const project = await resolveProject(t, projectCode, "task.write");
  if (codes.length === 0 || codes.length > 300) {
    throw badRequest("Envie de 1 a 300 tarefas na ordem nova.");
  }
  if (new Set(codes).size !== codes.length) {
    throw badRequest("A ordem nova repete alguma tarefa.");
  }
  const rows = await many<{ id: string; code: string; sort_key: number }>(
    t,
    `select id, code, sort_key from ${S}.tasks
      where project_id = $1 and code = any($2::text[]) and archived_at is null
      for update`,
    [project.id, codes],
  );
  if (rows.length !== codes.length) {
    throw unprocessable(
      "Alguma tarefa saiu do projeto ou foi arquivada. Recarregue o quadro.",
    );
  }
  const byCode = new Map(rows.map((r) => [r.code, r]));
  let changed = 0;
  for (const [i, code] of codes.entries()) {
    const row = byCode.get(code)!;
    const key = (i + 1) * 1024;
    if (Number(row.sort_key) === key) continue;
    await t.tx.query(`update ${S}.tasks set sort_key = $2 where id = $1`, [
      row.id,
      key,
    ]);
    changed += 1;
  }
  if (changed > 0) {
    await audit(t, {
      action: "tasks.reordered",
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
      after: { codes },
    });
  }
  return changed;
}
