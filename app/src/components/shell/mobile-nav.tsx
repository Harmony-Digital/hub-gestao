"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { Menu, Search, X } from "lucide-react";
import { openSearch } from "./command-palette";

/**
 * Celular e telas estreitas: barra no topo com o botão do menu, que abre a mesma barra
 * lateral numa gaveta (dialog nativo: Esc fecha e o foco fica preso dentro dela).
 * Não lê o endereço da página: fecha ao escolher um link.
 */
export function MobileNav({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-navy px-4 py-2.5 lg:hidden">
      <Link href="/" aria-label="Hoje no Hub">
        <Image
          src="/brand/harmony-logo-branco.png"
          alt="Harmony Digital"
          width={110}
          height={32}
          loading="eager"
          className="h-7 w-auto"
        />
      </Link>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openSearch}
          className="inline-flex size-11 items-center justify-center rounded-lg text-mist hover:bg-navy-2 hover:text-off"
        >
          <Search aria-hidden="true" className="size-5" />
          <span className="sr-only">Buscar no Hub</span>
        </button>
        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          className="inline-flex size-11 items-center justify-center rounded-lg text-mist hover:bg-navy-2 hover:text-off"
        >
          <Menu aria-hidden="true" className="size-5" />
          <span className="sr-only">Abrir o menu</span>
        </button>
      </div>
      <dialog
        ref={dialog}
        aria-label="Menu"
        onClick={(event) => {
          // Fecha ao tocar fora da gaveta, ao escolher um link (a tela muda em seguida) ou
          // um botão que abre outra janela (Buscar, Nova tarefa).
          const target = event.target as HTMLElement;
          if (
            target === dialog.current ||
            target.closest("a, [data-fecha-menu]")
          ) {
            dialog.current?.close();
          }
        }}
        className="m-0 h-full max-h-none w-[min(86vw,300px)] max-w-none bg-navy p-0 backdrop:bg-navy-3/60"
      >
        {/* Altura definida para o cartão de quem está logado ficar no pé, e espaço no
            topo para o botão de fechar não cobrir o selo "Hub". */}
        <div className="relative h-full overflow-y-auto pt-12">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="absolute top-3 right-3 z-10 inline-flex size-10 items-center justify-center rounded-lg text-mist hover:bg-navy-2 hover:text-off"
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">Fechar o menu</span>
          </button>
          {children}
        </div>
      </dialog>
    </div>
  );
}
