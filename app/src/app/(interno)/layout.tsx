import type { ReactNode } from "react";
import { MobileNav } from "@/components/shell/mobile-nav";
import { Sidebar } from "@/components/shell/sidebar";

/**
 * Estrutura de todas as telas internas: barra lateral fixa na tela larga e gaveta no
 * celular. A sessão é conferida dentro de cada parte (Suspense), nunca aqui no topo,
 * para a estrutura aparecer na hora (guia de autenticação com Cache Components).
 */
export default function InternoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 bg-background">
      <aside className="hidden w-[232px] shrink-0 lg:block">
        <div className="sticky top-0 h-screen overflow-y-auto">
          <Sidebar />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav>
          <Sidebar />
        </MobileNav>
        {children}
      </div>
    </div>
  );
}
