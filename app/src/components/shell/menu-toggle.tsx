"use client";

import { useSyncExternalStore } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

/** Chave no navegador; o script do layout raiz aplica a escolha antes de desenhar. */
export const MENU_KEY = "hub:menu";
const EVENT = "hub:menu-mudou";

function isCollapsed(): boolean {
  return document.documentElement.dataset.menu === "recolhido";
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/**
 * Recolhe a barra lateral (fica só com os ícones) ou abre de novo, na tela larga. A
 * escolha fica neste navegador; no celular o menu é sempre a gaveta inteira.
 */
export function MenuToggle() {
  const collapsed = useSyncExternalStore(subscribe, isCollapsed, () => false);
  const label = collapsed ? "Abrir o menu lateral" : "Recolher o menu lateral";
  return (
    <button
      type="button"
      onClick={() => {
        const next = !isCollapsed();
        if (next) document.documentElement.dataset.menu = "recolhido";
        else delete document.documentElement.dataset.menu;
        try {
          localStorage.setItem(MENU_KEY, next ? "recolhido" : "aberto");
        } catch {
          // Sem armazenamento (navegação privada): vale só até recarregar.
        }
        window.dispatchEvent(new Event(EVENT));
      }}
      aria-pressed={collapsed}
      aria-label={label}
      title={label}
      className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-mist transition-colors hover:bg-navy-2 hover:text-off lg:inline-flex"
    >
      {collapsed ? (
        <PanelLeftOpen aria-hidden="true" className="size-[18px]" />
      ) : (
        <PanelLeftClose aria-hidden="true" className="size-[18px]" />
      )}
    </button>
  );
}
