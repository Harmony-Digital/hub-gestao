"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Início" },
  { href: "/agentes", label: "Agentes" },
] as const;

/** Navegação das telas internas; a atual fica marcada para leitores de tela também. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Telas do Hub" className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active =
          link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              active
                ? "bg-navy-4 font-semibold text-off"
                : "text-mist hover:bg-navy-4 hover:text-off"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
