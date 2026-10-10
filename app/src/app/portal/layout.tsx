import type { Metadata } from "next";
import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Portal do cliente (D9): só entra quem o dono liberou, por link de uso único. Fora dos
 * buscadores (noindex) e sem rastreadores de terceiros.
 */
export const metadata: Metadata = {
  title: { default: "Portal do cliente", template: "%s · Portal do cliente" },
  robots: { index: false, follow: false, nocache: true },
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-paper">
      <header className="bg-navy">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-4 sm:px-6">
          <Image
            src="/brand/harmony-logo-branco.png"
            alt="Harmony Digital"
            width={140}
            height={40}
            loading="eager"
            className="h-8 w-auto"
          />
          <span className="font-mono text-[11px] tracking-[0.12em] text-brand-soft uppercase">
            Portal do cliente
          </span>
        </div>
      </header>
      {children}
      <footer className="mx-auto w-full max-w-4xl px-4 py-8 text-xs text-caption sm:px-6">
        Harmony Digital · Este portal mostra o andamento dos seus projetos com a
        Harmony.
      </footer>
    </div>
  );
}
