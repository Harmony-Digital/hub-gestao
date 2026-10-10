"use client";

import { Plus, Search } from "lucide-react";
import { openQuickCreate, openSearch } from "./command-palette";

/**
 * Botões do menu, em qualquer tela: Buscar (a janela ⌘K) e Nova tarefa (criação rápida).
 * No celular, tocar num deles fecha a gaveta do menu (`data-fecha-menu`).
 */
export function ShellActions() {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-fecha-menu=""
        onClick={openSearch}
        aria-keyshortcuts="Meta+K Control+K"
        title="Buscar (⌘K)"
        className="hub-centro flex min-h-10 items-center gap-2.5 rounded-[10px] border border-off/10 bg-navy-2 px-3 text-sm text-mist transition-colors hover:text-off"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="hub-rotulo flex-1 text-left">Buscar</span>
        <kbd
          aria-hidden="true"
          className="hub-so-aberto rounded border border-off/15 px-1.5 font-mono text-[10px] text-mist-2"
        >
          ⌘K
        </kbd>
      </button>
      <button
        type="button"
        data-fecha-menu=""
        onClick={openQuickCreate}
        title="Nova tarefa"
        className="hub-centro flex min-h-10 items-center gap-2.5 rounded-[10px] px-3 text-sm font-medium text-mist transition-colors hover:bg-navy-2 hover:text-off"
      >
        <Plus aria-hidden="true" className="size-4 shrink-0" />
        <span className="hub-rotulo">Nova tarefa</span>
      </button>
    </div>
  );
}
