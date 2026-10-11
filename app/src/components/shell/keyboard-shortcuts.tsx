"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openQuickCreate, openSearch } from "./command-palette";
import {
  focusKeepsKeys,
  GO_TO,
  OPEN_SHORTCUTS_EVENT,
  PROJECT_GO_TO,
  setShortcutsOn,
  shortcutFor,
  shortcutsOn,
  SINGLE_KEYS,
} from "./shortcuts";

/** Quanto tempo o "g" espera a letra seguinte. */
const SEQUENCE_MS = 1500;

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((k, i) => (
        <kbd
          key={`${k}-${i}`}
          className="min-w-6 rounded-md border border-line bg-off px-1.5 py-0.5 text-center font-mono text-xs text-navy"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink">{label}</span>
      <Keys keys={keys} />
    </li>
  );
}

/**
 * Atalhos de teclado em todas as telas internas (RF-21) e a lista deles ("?" ou ⌘K →
 * "Atalhos de teclado"), com a opção de desligar os de uma tecla. Não age com alguém
 * digitando, com janela aberta nem com Ctrl, ⌘ ou Alt apertado.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [on, setOn] = useState(true);
  const id = useId();

  useEffect(() => {
    let afterG = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      setOn(shortcutsOn());
      if (dialog.current && !dialog.current.open) dialog.current.showModal();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      if (event.altKey || event.repeat) return;
      if (focusKeepsKeys(document.activeElement as HTMLInputElement | null)) {
        return;
      }
      if (document.querySelector("dialog[open]")) return;
      if (!shortcutsOn()) return;
      const result = shortcutFor(event.key, afterG, window.location.pathname);
      afterG = result.afterG;
      clearTimeout(timer);
      if (afterG) {
        timer = setTimeout(() => {
          afterG = false;
        }, SEQUENCE_MS);
      }
      const action = result.action;
      if (!action) return;
      event.preventDefault();
      if (action.kind === "search") openSearch();
      else if (action.kind === "create") openQuickCreate();
      else if (action.kind === "help") show();
      else router.push(action.href);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SHORTCUTS_EVENT, show);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SHORTCUTS_EVENT, show);
    };
  }, [router]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-titulo`}
      className="m-auto w-[min(92vw,30rem)] max-w-none rounded-2xl border border-line bg-paper p-0 text-left whitespace-normal text-ink shadow-2xl backdrop:bg-navy-3/50"
    >
      <div className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <h2
            id={`${id}-titulo`}
            className="font-heading text-lg font-semibold text-navy"
          >
            Atalhos de teclado
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Fechar"
            onClick={() => dialog.current?.close()}
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        <section aria-labelledby={`${id}-geral`} className="flex flex-col">
          <h3 id={`${id}-geral`} className="text-sm font-semibold text-navy">
            Em qualquer tela
          </h3>
          <ul className="divide-y divide-line">
            <Row keys={["⌘", "K"]} label="Buscar ou pedir ao Concierge" />
            {SINGLE_KEYS.map((s) => (
              <Row key={s.key} keys={[s.key]} label={s.label} />
            ))}
            <Row keys={["Esc"]} label="Fechar o painel da tarefa ou a janela" />
          </ul>
        </section>

        <section aria-labelledby={`${id}-ir`} className="flex flex-col">
          <h3 id={`${id}-ir`} className="text-sm font-semibold text-navy">
            Ir para (aperte g e depois a letra)
          </h3>
          <ul className="divide-y divide-line">
            {GO_TO.map((g) => (
              <Row key={g.key} keys={["g", g.key]} label={g.label} />
            ))}
            {PROJECT_GO_TO.map((g) => (
              <Row key={g.key} keys={["g", g.key]} label={g.label} />
            ))}
          </ul>
        </section>

        <div className="flex flex-col gap-1 rounded-xl bg-off p-3">
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={on}
              onChange={(event) => {
                setShortcutsOn(event.currentTarget.checked);
                setOn(event.currentTarget.checked);
              }}
              className="mt-0.5 size-4 accent-[var(--color-brand)]"
            />
            Usar os atalhos de uma tecla
          </label>
          <p className="text-xs text-ink-2">
            Desligue se eles atrapalham o leitor de tela ou o ditado. O ⌘K e
            esta lista (pelo ⌘K, “Atalhos de teclado”) continuam valendo. A
            escolha fica neste navegador.
          </p>
        </div>
      </div>
    </dialog>
  );
}
