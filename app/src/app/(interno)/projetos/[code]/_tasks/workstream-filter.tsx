import { FilterChip } from "@/components/shell/filter-chip";
import type { WorkstreamOption } from "@/modules/tasks/board";
import { viewHref } from "./params";

/** Filtro por frente da Lista e do Quadro. No celular, os botões rolam para o lado. */
export function WorkstreamFilter({
  basePath,
  workstreams,
  active,
}: {
  basePath: string;
  workstreams: WorkstreamOption[];
  /** "none", o id da frente filtrada ou null (todas). */
  active: string | null;
}) {
  if (workstreams.length === 0) return null;
  return (
    <nav
      aria-label="Filtrar por frente"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
    >
      <FilterChip href={viewHref(basePath, null)} active={!active}>
        Todas as frentes
      </FilterChip>
      {workstreams.map((w) => (
        <FilterChip
          key={w.id}
          href={viewHref(basePath, w.id)}
          active={active === w.id}
        >
          {w.title}
        </FilterChip>
      ))}
      <FilterChip href={viewHref(basePath, "none")} active={active === "none"}>
        Sem frente
      </FilterChip>
    </nav>
  );
}
