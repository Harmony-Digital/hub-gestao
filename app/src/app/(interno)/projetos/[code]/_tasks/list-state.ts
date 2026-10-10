/**
 * Estado da Lista e do Quadro guardado no endereço: filtros combináveis (frente,
 * responsável, prioridade, prazo, busca) e, na Lista, agrupamento, ordem e colunas.
 * Puro: vale no servidor, no navegador e nos testes. Valor fora do formato é ignorado.
 */

import type { TaskDto } from "@/modules/tasks/schemas";

type Query = Record<string, string | string[] | undefined>;

export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const GROUPS = [
  "status",
  "frente",
  "responsavel",
  "prioridade",
] as const;
export type Group = (typeof GROUPS)[number];

export const ORDERS = [
  "padrao",
  "prazo",
  "prioridade",
  "recentes",
  "codigo",
] as const;
export type Order = (typeof ORDERS)[number];

export const COLUMNS = [
  "frente",
  "responsavel",
  "prazo",
  "prioridade",
] as const;
export type Column = (typeof COLUMNS)[number];

export const DUE = ["atrasadas", "semana", "sem"] as const;
export type Due = (typeof DUE)[number];

export type ListState = {
  /** "none" (sem frente) ou o id de uma frente. */
  frente: string | null;
  /** "eu", "nenhum", "user:<id>" ou "agent:<id>". */
  resp: string | null;
  prio: Priority[];
  prazo: Due | null;
  busca: string | null;
  agrupar: Group;
  ordem: Order;
  colunas: Column[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;

function all(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).flatMap((v) => v.split(","));
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pick<T extends string>(
  list: readonly T[],
  value: string | undefined,
  fallback: T,
): T {
  return value && (list as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function readListState(query: Query): ListState {
  const frente = one(query.frente);
  const resp = one(query.resp);
  const busca = one(query.busca)?.trim();
  const cols = all(query.col).filter((c): c is Column =>
    (COLUMNS as readonly string[]).includes(c),
  );
  return {
    frente: frente === "none" || (frente && UUID.test(frente)) ? frente : null,
    resp:
      resp === "eu" ||
      resp === "nenhum" ||
      (resp &&
        /^(user|agent):/.test(resp) &&
        UUID.test(resp.slice(resp.indexOf(":") + 1)))
        ? resp
        : null,
    prio: [
      ...new Set(
        all(query.prio).filter((p): p is Priority =>
          (PRIORITIES as readonly string[]).includes(p),
        ),
      ),
    ],
    prazo: (DUE as readonly string[]).includes(one(query.prazo) ?? "")
      ? (one(query.prazo) as Due)
      : null,
    busca: busca && busca.length <= 80 && !CONTROL.test(busca) ? busca : null,
    agrupar: pick(GROUPS, one(query.agrupar), "status"),
    ordem: pick(ORDERS, one(query.ordem), "padrao"),
    // Sem o parâmetro, todas as colunas; com ele, só as marcadas (o marcador "titulo"
    // mantém o parâmetro mesmo quando nenhuma coluna extra fica marcada).
    colunas:
      query.col === undefined ||
      (cols.length === 0 && all(query.col).length === 0)
        ? [...COLUMNS]
        : cols,
  };
}

/** Parâmetros do endereço para um estado (só o que difere do padrão). */
export function listQuery(state: ListState): URLSearchParams {
  const q = new URLSearchParams();
  if (state.frente) q.set("frente", state.frente);
  if (state.resp) q.set("resp", state.resp);
  if (state.prio.length) q.set("prio", state.prio.join(","));
  if (state.prazo) q.set("prazo", state.prazo);
  if (state.busca) q.set("busca", state.busca);
  if (state.agrupar !== "status") q.set("agrupar", state.agrupar);
  if (state.ordem !== "padrao") q.set("ordem", state.ordem);
  if (
    state.colunas.length !== COLUMNS.length ||
    !COLUMNS.every((c) => state.colunas.includes(c))
  ) {
    q.set("col", ["titulo", ...state.colunas].join(","));
  }
  return q;
}

export function hasFilters(state: ListState): boolean {
  return Boolean(
    state.frente ||
    state.resp ||
    state.prio.length ||
    state.prazo ||
    state.busca,
  );
}

// Ordem e grupos ----------------------------------------------------------------------

const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function codeNumber(code: string): number {
  return Number(code.slice(code.lastIndexOf("-") + 1));
}

/** A ordem "padrão" é a do servidor (prioridade, prazo, posição); as outras, aqui. */
export function sortTasks(tasks: TaskDto[], order: Order): TaskDto[] {
  if (order === "padrao") return tasks;
  const list = [...tasks];
  const byDue = (a: TaskDto, b: TaskDto) =>
    (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31");
  switch (order) {
    case "prazo":
      return list.sort(
        (a, b) => byDue(a, b) || codeNumber(a.code) - codeNumber(b.code),
      );
    case "prioridade":
      return list.sort(
        (a, b) =>
          PRIORITY_RANK[a.priority as Priority] -
            PRIORITY_RANK[b.priority as Priority] || byDue(a, b),
      );
    case "recentes":
      return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case "codigo":
      return list.sort((a, b) => codeNumber(a.code) - codeNumber(b.code));
  }
}

export type TaskGroup = {
  key: string;
  label: string;
  tasks: TaskDto[];
  /** Grupo de concluídas: começa fechado. */
  done: boolean;
};

const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgente",
  high: "Alta",
  normal: "Normal",
  low: "Baixa",
};

/**
 * Grupos da Lista quando não é por status. As concluídas ficam num grupo próprio no fim,
 * fechado, para não misturar com o trabalho em aberto.
 */
export function groupTasks(
  tasks: TaskDto[],
  by: Exclude<Group, "status">,
  workstreams: { id: string; title: string }[],
): TaskGroup[] {
  const open = tasks.filter((t) => t.status.category !== "done");
  const done = tasks.filter((t) => t.status.category === "done");
  const groups: TaskGroup[] = [];
  const add = (key: string, label: string, list: TaskDto[]) => {
    if (list.length) groups.push({ key, label, tasks: list, done: false });
  };
  if (by === "frente") {
    for (const w of workstreams) {
      add(
        w.id,
        w.title,
        open.filter((t) => t.workstream?.id === w.id),
      );
    }
    add(
      "none",
      "Sem frente",
      open.filter((t) => !t.workstream),
    );
  } else if (by === "prioridade") {
    for (const p of PRIORITIES) {
      add(
        p,
        PRIORITY_LABEL[p],
        open.filter((t) => t.priority === p),
      );
    }
  } else {
    const people = new Map<string, { label: string; agent: boolean }>();
    for (const t of open) {
      if (t.assignee?.id) {
        people.set(`${t.assignee.type}:${t.assignee.id}`, {
          label: t.assignee.name ?? "Sem nome",
          agent: t.assignee.type === "agent",
        });
      }
    }
    const ordered = [...people.entries()].sort(
      ([, a], [, b]) =>
        Number(a.agent) - Number(b.agent) || a.label.localeCompare(b.label),
    );
    for (const [key, p] of ordered) {
      add(
        key,
        p.label,
        open.filter(
          (t) => t.assignee && `${t.assignee.type}:${t.assignee.id}` === key,
        ),
      );
    }
    add(
      "none",
      "Ninguém",
      open.filter((t) => !t.assignee),
    );
  }
  if (done.length) {
    groups.push({ key: "done", label: "Concluídas", tasks: done, done: true });
  }
  return groups;
}

/** Filtros do endereço no formato do núcleo (`projectTaskList`). */
export function toTaskFilter(state: ListState): {
  workstream: string | null;
  assignee: string | null;
  priorities: Priority[];
  due: "late" | "week" | "none" | null;
  search: string | null;
} {
  return {
    workstream: state.frente,
    assignee:
      state.resp === "eu"
        ? "me"
        : state.resp === "nenhum"
          ? "none"
          : state.resp,
    priorities: state.prio,
    due:
      state.prazo === "atrasadas"
        ? "late"
        : state.prazo === "semana"
          ? "week"
          : state.prazo === "sem"
            ? "none"
            : null,
    search: state.busca,
  };
}
