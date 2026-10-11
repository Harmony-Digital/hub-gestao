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
  workstreamId: string | null;
  assignee: { name: string; agent: boolean } | null;
  /** "user:<id>" ou "agent:<id>" (raias por responsável). */
  assigneeKey: string | null;
  /** Posição manual na coluna (quadro); empate fica na ordem de trabalho do servidor. */
  sortKey: number;
  due: string | null;
  late: boolean;
  parent: string | null;
  done: boolean;
  /** Tarefas abertas de que esta depende (códigos); vazio em tarefa concluída. */
  waitingOn: string[];
  /** Etiquetas (RF-18), em ordem alfabética. */
  labels: { name: string; color: string }[];
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
  waitingOn: string[] = [],
): BoardCard {
  const done = task.status.category === "done";
  return {
    code: task.code,
    title: task.title,
    statusId: task.status.id,
    version: task.version,
    priority: task.priority,
    workstream: task.workstream?.title ?? null,
    workstreamId: task.workstream?.id ?? null,
    assigneeKey: task.assignee?.id
      ? `${task.assignee.type}:${task.assignee.id}`
      : null,
    sortKey: task.sort_key,
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
    waitingOn: done ? [] : waitingOn,
    labels: task.labels,
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

/** Ordem do quadro: a posição manual primeiro; no empate, a ordem que veio do servidor. */
export function sortForBoard(cards: BoardCard[]): BoardCard[] {
  return [...cards].sort((a, b) => a.sortKey - b.sortKey);
}

/**
 * Leva o cartão para a coluna `statusId`, antes do cartão `before` (se ele estiver nessa
 * coluna) ou no fim dela. As posições da coluna de destino são renumeradas na ordem nova.
 */
export function placeCard(
  cards: BoardCard[],
  code: string,
  statusId: string,
  before: string | null,
): BoardCard[] {
  const card = cards.find((c) => c.code === code);
  if (!card) return cards;
  const moved = { ...card, statusId };
  const rest = cards.filter((c) => c.code !== code);
  const column = rest.filter((c) => c.statusId === statusId);
  const at = before ? column.findIndex((c) => c.code === before) : -1;
  const ordered =
    at === -1
      ? [...column, moved]
      : [...column.slice(0, at), moved, ...column.slice(at)];
  const keys = new Map(ordered.map((c, i) => [c.code, (i + 1) * 1024]));
  return [
    ...rest
      .filter((c) => c.statusId !== statusId)
      .concat(ordered)
      .map((c) =>
        keys.has(c.code) ? { ...c, sortKey: keys.get(c.code)! } : c,
      ),
  ];
}

/** Códigos da coluna na ordem em que aparecem (o que vai para o servidor gravar). */
export function columnCodes(cards: BoardCard[], statusId: string): string[] {
  return sortForBoard(cards.filter((c) => c.statusId === statusId)).map(
    (c) => c.code,
  );
}

export type LaneBy = "frente" | "responsavel";

/** Raia do cartão: a frente ou o responsável ("none" quando não há). */
export function laneOf(card: BoardCard, by: LaneBy): string {
  return (by === "frente" ? card.workstreamId : card.assigneeKey) ?? "none";
}

export type BoardLane = { key: string; label: string };

/**
 * Raias que aparecem: só as que têm cartão. Frentes na ordem do projeto; responsáveis com
 * as pessoas antes dos agentes, por nome. "Sem frente" ou "Ninguém" fica no fim.
 */
export function boardLanes(
  cards: BoardCard[],
  by: LaneBy,
  workstreamOrder: string[],
): BoardLane[] {
  const found = new Map<
    string,
    { label: string; rank: number; agent: boolean }
  >();
  let none = false;
  for (const card of cards) {
    const key = laneOf(card, by);
    if (key === "none") none = true;
    if (key === "none" || found.has(key)) continue;
    const rank = by === "frente" ? workstreamOrder.indexOf(key) : 0;
    found.set(key, {
      label:
        (by === "frente" ? card.workstream : card.assignee?.name) ?? "Sem nome",
      rank: rank === -1 ? Number.MAX_SAFE_INTEGER : rank,
      agent: by === "responsavel" && Boolean(card.assignee?.agent),
    });
  }
  const lanes = [...found.entries()]
    .sort(
      ([, a], [, b]) =>
        a.rank - b.rank ||
        Number(a.agent) - Number(b.agent) ||
        a.label.localeCompare(b.label, "pt-BR"),
    )
    .map(([key, lane]) => ({ key, label: lane.label }));
  if (none) {
    lanes.push({
      key: "none",
      label: by === "frente" ? "Sem frente" : "Ninguém",
    });
  }
  return lanes;
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
