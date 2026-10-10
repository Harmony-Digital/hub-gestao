import { Bot, FolderKanban, Sun, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

/** Só telas que já existem; cada nova tela entra aqui quando ficar pronta. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Hoje", icon: Sun },
  { href: "/projetos", label: "Projetos", icon: FolderKanban },
  { href: "/agentes", label: "Sala de Controle", icon: Bot },
];

export function isActive(href: string, pathname: string): boolean {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export const NAV_LINK_CLASS =
  "flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 text-sm transition-colors";
export const NAV_LINK_IDLE =
  "font-medium text-mist hover:bg-navy-2 hover:text-off";
export const NAV_LINK_ACTIVE = "bg-navy-4 font-semibold text-off";
