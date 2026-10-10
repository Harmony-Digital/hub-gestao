"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  isActive,
  NAV_ITEMS,
  NAV_LINK_ACTIVE,
  NAV_LINK_CLASS,
  NAV_LINK_IDLE,
} from "./nav-items";

/** Menu com o item da tela atual destacado (lê o endereço: só dentro de Suspense). */
/** Contador ao lado do item do menu, com o texto que o leitor de tela anuncia. */
export type NavBadge = { n: number; label: string };

export function SidebarNav({
  badges = {},
}: {
  badges?: Record<string, NavBadge>;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menu principal" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href, pathname);
        const badge = badges[href];
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            title={label}
            className={`hub-centro relative ${NAV_LINK_CLASS} ${active ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
          >
            <Icon
              aria-hidden="true"
              className={`size-[18px] shrink-0 ${active ? "text-brand" : ""}`}
            />
            <span className="hub-rotulo flex-1">{label}</span>
            {badge && badge.n > 0 ? (
              <span
                className="hub-contador rounded-full bg-brand px-2 font-mono text-[11px] font-semibold text-navy"
                aria-label={badge.label}
              >
                {badge.n}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
