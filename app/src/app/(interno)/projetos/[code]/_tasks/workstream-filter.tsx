import Link from "next/link";
import type { ReactNode } from "react";
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

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-9 shrink-0 items-center rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors ${
        active
          ? "border-navy bg-navy text-off"
          : "border-line bg-paper text-ink-2 hover:border-mist hover:text-navy"
      }`}
    >
      {children}
    </Link>
  );
}
