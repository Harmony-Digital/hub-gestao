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
export function SidebarNav({
  badges = {},
}: {
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menu principal" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(href, pathname);
        const badge = badges[href] ?? 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`${NAV_LINK_CLASS} ${active ? NAV_LINK_ACTIVE : NAV_LINK_IDLE}`}
          >
            <Icon
              aria-hidden="true"
              className={`size-[18px] shrink-0 ${active ? "text-brand" : ""}`}
            />
            <span className="flex-1">{label}</span>
            {badge > 0 ? (
              <span
                className="rounded-full bg-brand px-2 font-mono text-[11px] font-semibold text-navy"
                aria-label={`${badge} decisões esperando você`}
              >
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
