import Link from "next/link";
import type { ReactNode } from "react";

/** Botão de filtro em forma de pílula; o ativo fica em azul-marinho. */
export function FilterChip({
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
      className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors ${
        active
          ? "border-navy bg-navy text-off"
          : "border-line bg-paper text-ink-2 hover:border-mist hover:text-navy"
      }`}
    >
      {children}
    </Link>
  );
}
