import type { ReactNode } from "react";
import { Archive, ChevronDown } from "lucide-react";

/**
 * Lista de arquivados, recolhida no fim da tela (marcos, frentes, projetos, clientes).
 * Os itens (`<li>`) vêm de quem usa, com o Restaurar ou o link de cada um.
 */
export function ArchivedSection({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="group rounded-xl border border-dashed border-line">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-ink-2 hover:text-navy [&::-webkit-details-marker]:hidden">
        <Archive aria-hidden="true" className="size-4" />
        {label}
        <span className="font-mono text-xs text-caption">{count}</span>
        <ChevronDown
          aria-hidden="true"
          className="ml-auto size-4 transition-transform group-open:rotate-180"
        />
      </summary>
      <ul className="divide-y divide-line border-t border-dashed border-line">
        {children}
      </ul>
    </details>
  );
}

/** "arquivado em 10/10" no começo da linha vira "Arquivado em 10/10". */
export function archivedWhen(
  verb: string,
  day: string,
  note?: string | null,
): string {
  const when = `${verb} em ${day}`;
  return note
    ? `${note} · ${when}`
    : `${when[0].toUpperCase()}${when.slice(1)}`;
}
