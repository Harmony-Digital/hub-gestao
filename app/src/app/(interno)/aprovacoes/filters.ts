/**
 * Filtros da tela Aprovações (situação, tipo e projeto), lidos do endereço. Sem
 * dependências de servidor, para valer na tela e nos testes.
 */
import { APPROVAL_TYPE } from "@/lib/labels";

export type StatusFilter = "pendentes" | "historico" | "todas";
export type ApprovalType = keyof typeof APPROVAL_TYPE;

export type ApprovalFilters = {
  status: StatusFilter;
  type: ApprovalType | null;
  project: string | null;
};

const PROJECT_CODE = /^[A-Z0-9]{2,8}$/;

export function parseFilters(query: {
  status?: string;
  tipo?: string;
  projeto?: string;
}): ApprovalFilters {
  return {
    status:
      query.status === "historico" || query.status === "todas"
        ? query.status
        : "pendentes",
    type:
      query.tipo && Object.hasOwn(APPROVAL_TYPE, query.tipo)
        ? (query.tipo as ApprovalType)
        : null,
    project:
      query.projeto && PROJECT_CODE.test(query.projeto) ? query.projeto : null,
  };
}

/** Endereço com os filtros; os valores padrão ficam fora para o link sair curto. */
export function filtersHref(f: ApprovalFilters): string {
  const params = new URLSearchParams();
  if (f.status !== "pendentes") params.set("status", f.status);
  if (f.type) params.set("tipo", f.type);
  if (f.project) params.set("projeto", f.project);
  const query = params.toString();
  return query ? `/aprovacoes?${query}` : "/aprovacoes";
}

function inStatus(status: string, filter: StatusFilter): boolean {
  if (filter === "todas") return true;
  return filter === "pendentes" ? status === "pending" : status !== "pending";
}

type Filterable = { status: string; type: string; project_code: string | null };

/**
 * Aplica os filtros e devolve também o que alimenta os botões: a contagem por situação
 * (com tipo e projeto aplicados) e os tipos e projetos que existem na situação escolhida.
 */
export function applyFilters<T extends Filterable>(
  items: T[],
  f: ApprovalFilters,
) {
  const byType = (a: T) => !f.type || a.type === f.type;
  const byProject = (a: T) => !f.project || a.project_code === f.project;
  const counted = items.filter((a) => byType(a) && byProject(a));
  return {
    visible: counted.filter((a) => inStatus(a.status, f.status)),
    counts: {
      pendentes: counted.filter((a) => a.status === "pending").length,
      historico: counted.filter((a) => a.status !== "pending").length,
      todas: counted.length,
    },
    types: [
      ...new Set(
        items
          .filter((a) => inStatus(a.status, f.status) && byProject(a))
          .map((a) => a.type),
      ),
    ].filter((t): t is ApprovalType => Object.hasOwn(APPROVAL_TYPE, t)),
    projects: [
      ...new Set(
        items
          .filter((a) => inStatus(a.status, f.status) && byType(a))
          .map((a) => a.project_code)
          .filter((c): c is string => Boolean(c)),
      ),
    ].sort(),
  };
}
