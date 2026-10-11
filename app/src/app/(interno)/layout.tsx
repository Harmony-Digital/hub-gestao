import type { ReactNode } from "react";
import { CommandPalette } from "@/components/shell/command-palette";
import { KeyboardShortcuts } from "@/components/shell/keyboard-shortcuts";
import { MobileNav } from "@/components/shell/mobile-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { ThemeWatcher } from "@/components/shell/theme-watcher";

/**
 * Estrutura de todas as telas internas: barra lateral fixa na tela larga e gaveta no
 * celular. A sessão é conferida dentro de cada parte (Suspense), nunca aqui no topo,
 * para a estrutura aparecer na hora (guia de autenticação com Cache Components).
 */
export default function InternoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 bg-background">
      {/* Teclado: o primeiro Tab pula o menu e leva direto ao conteúdo. */}
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-lg bg-brand px-4 py-2 font-semibold text-navy focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Pular para o conteúdo
      </a>
      <aside className="hub-lateral hidden w-[232px] shrink-0 transition-[width] lg:block">
        <div className="sticky top-0 h-screen overflow-y-auto">
          <Sidebar />
        </div>
      </aside>
      <div
        id="conteudo"
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col outline-none"
      >
        <MobileNav>
          <Sidebar />
        </MobileNav>
        {children}
      </div>
      {/* Janela ⌘K e Nova tarefa de qualquer tela (uma só para todas as telas). */}
      <CommandPalette />
      {/* Atalhos de teclado (RF-21) e a lista deles ("?"). */}
      <KeyboardShortcuts />
      <ThemeWatcher />
    </div>
  );
}
