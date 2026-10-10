"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Moldura do painel da tarefa, à direita da lista. Esc fecha (menos quando o foco está
 * num campo, para não perder o que está sendo escrito) e o foco vai para o painel ao
 * abrir outra tarefa. A lista continua clicável ao lado.
 */
export function TaskPanelFrame({
  taskCode,
  closeHref,
  children,
}: {
  taskCode: string;
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, [taskCode]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, dialog[open]")) return;
      if (document.querySelector("dialog[open]")) return;
      router.push(closeHref, { scroll: false });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeHref, router]);

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-labelledby="painel-tarefa-titulo"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-paper shadow-2xl outline-none sm:w-[min(100vw,36rem)]"
    >
      {/* Barra fixa no topo: o botão de fechar nunca cobre os campos ao rolar. */}
      <div className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-line pr-2 pl-5 sm:pl-6">
        <span className="font-mono text-sm font-semibold text-navy">
          {taskCode}
        </span>
        <Link
          href={closeHref}
          scroll={false}
          className="inline-flex size-10 items-center justify-center rounded-lg text-caption hover:bg-off-2 hover:text-navy"
        >
          <X aria-hidden="true" className="size-5" />
          <span className="sr-only">Fechar o painel da tarefa</span>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
