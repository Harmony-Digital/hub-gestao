/**
 * Estado do quadro (Kanban): cartões leves montados no servidor e as contas que a tela
 * faz ao arrastar. Sem dependências de servidor nem de React, para valer nos dois lados
 * e nos testes.
 */
import type { StatusOption } from "@/modules/tasks/board";
import type { TaskDto } from "@/modules/tasks/schemas";

export type BoardCard = {
  code: string;
  title: string;
  statusId: string;
  version: number;
  priority: TaskDto["priority"];
  workstream: string | null;
  assignee: { name: string; agent: boolean } | null;
  due: string | null;
  late: boolean;
  parent: string | null;
  done: boolean;
  /** Endereço que abre o painel da tarefa nesta tela. */
  href: string;
};

export type BoardColumn = StatusOption & {
  /** Total da coluna. Em Concluída pode passar do que aparece (só as mais recentes). */
  total: number;
};

export function toBoardCard(
  task: TaskDto,
  today: string,
  href: string,
): BoardCard {
  const done = task.status.category === "done";
  return {
    code: task.code,
    title: task.title,
    statusId: task.status.id,
    version: task.version,
    priority: task.priority,
    workstream: task.workstream?.title ?? null,
    assignee: task.assignee
      ? {
          name: task.assignee.name ?? "Sem nome",
          agent: task.assignee.type === "agent",
        }
      : null,
    due: task.due_date,
    late: task.due_date !== null && task.due_date < today && !done,
    parent: task.parent_code,
    done,
    href,
  };
}

export function boardColumns(
  statuses: StatusOption[],
  tasks: Pick<TaskDto, "status">[],
  doneTotal: number,
): BoardColumn[] {
  // Com um só status de concluída, o total vem da contagem completa (a lista traz só as
  // mais recentes); com mais de um, cada coluna conta o que recebeu.
  const doneColumns = statuses.filter((s) => s.category === "done").length;
  return statuses.map((s) => ({
    ...s,
    total:
      s.category === "done" && doneColumns === 1
        ? doneTotal
        : tasks.filter((t) => t.status.id === s.id).length,
  }));
}

/** Coluna de destino pede um texto antes de mover (evidência ou motivo)? */
export function needsNote(column: Pick<StatusOption, "category">): boolean {
  return column.category === "done" || column.category === "blocked";
}

/** Move o cartão para outra coluna, no topo dela, sem mexer nos demais. */
export function moveCard(
  cards: BoardCard[],
  code: string,
  statusId: string,
): BoardCard[] {
  const card = cards.find((c) => c.code === code);
  if (!card || card.statusId === statusId) return cards;
  const moved = { ...card, statusId };
  const rest = cards.filter((c) => c.code !== code);
  const firstOfColumn = rest.findIndex((c) => c.statusId === statusId);
  if (firstOfColumn === -1) return [...rest, moved];
  return [...rest.slice(0, firstOfColumn), moved, ...rest.slice(firstOfColumn)];
}

type Span = { id: string; left: number; width: number };

/**
 * Teclado no quadro: para qual coluna as setas levam o cartão. Escolhe a coluna em que o
 * centro do cartão está (ou a mais próxima) e anda uma para o lado.
 */
export function columnBeside(
  columns: Span[],
  centerX: number,
  step: -1 | 1,
): Span | null {
  if (columns.length === 0) return null;
  const sorted = [...columns].sort((a, b) => a.left - b.left);
  let current = sorted.findIndex(
    (c) => centerX >= c.left && centerX <= c.left + c.width,
  );
  if (current === -1) {
    let best = Infinity;
    sorted.forEach((c, i) => {
      const distance = Math.abs(c.left + c.width / 2 - centerX);
      if (distance < best) {
        best = distance;
        current = i;
      }
    });
  }
  return sorted[current + step] ?? null;
}
