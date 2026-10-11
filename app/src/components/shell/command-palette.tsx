"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { LoaderCircle, Mic, MicOff, Search } from "lucide-react";
import { interpretarPedido } from "@/app/(interno)/_concierge/actions";
import {
  ConciergePanel,
  type ConciergeRequest,
} from "@/app/(interno)/_concierge/concierge-panel";
import type { InterpretState } from "@/app/(interno)/_concierge/state";
import { recognitionCtor, useDictation } from "./dictation";
import {
  CONCIERGE_MIN,
  paletteItems,
  step,
  type PaletteItem,
  type SearchResult,
} from "./palette-items";
import { QuickCreateDialog } from "./quick-create";
import { openShortcuts } from "./shortcuts";
import { darkNow, setTheme, subscribeTheme } from "./theme";

export const OPEN_SEARCH_EVENT = "hub:abrir-busca";
export const OPEN_QUICK_CREATE_EVENT = "hub:nova-tarefa";

/** Abrem a janela ⌘K e a criação rápida de qualquer lugar (botões do menu). */
export function openSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}
export function openQuickCreate() {
  window.dispatchEvent(new Event(OPEN_QUICK_CREATE_EVENT));
}

type Found = { q: string; data: SearchResult } | { q: string; error: string };

type Asked = { request: ConciergeRequest; result: InterpretState | null };

/** A busca do Hub aceita de 2 a 100 caracteres; pedido mais longo vai só ao Concierge. */
const SEARCH_MAX = 100;
const noop = () => () => {};

/**
 * Janela ⌘K (ou Ctrl+K): vai para qualquer tela, acha tarefa, projeto, marco ou frente
 * pela busca do Hub (só no alcance de quem está logado) e cria tarefa de qualquer lugar.
 * Setas escolhem, Enter abre, Esc fecha. Uma frase vira pedido ao Concierge (CO-10),
 * digitado ou ditado pelo microfone: ele mostra a prévia, e nada é feito sem confirmar.
 */
export function CommandPalette() {
  const router = useRouter();
  // A janela fica em estado, não em ref: os efeitos e os atalhos a abrem.
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [canCreateProject, setCanCreateProject] = useState(false);
  const [conciergeState, setConciergeState] = useState<"ready" | "off" | null>(
    null,
  );
  const [asked, setAsked] = useState<Asked | null>(null);
  const [creating, setCreating] = useState(false);
  const dark = useSyncExternalStore(subscribeTheme, darkNow, () => false);
  const canDictate = useSyncExternalStore(
    noop,
    () => recognitionCtor() !== null,
    () => false,
  );
  const listId = useId();

  /** Manda o pedido ao Concierge; a resposta velha (de outro pedido) é descartada. */
  const ask = useCallback((text: string, voice: boolean, started: number) => {
    const request: ConciergeRequest = {
      id: Date.now(),
      text: text.trim(),
      voice,
      started,
    };
    setAsked({ request, result: null });
    interpretarPedido({ text: request.text, path: window.location.pathname })
      .catch((): InterpretState => ({
        ok: false,
        message: "Falha ao falar com o servidor. Tente de novo.",
      }))
      .then((result) =>
        setAsked((current) =>
          current?.request.id === request.id ? { request, result } : current,
        ),
      );
  }, []);

  // Início do ditado: o tempo do pedido por voz conta desde o clique no microfone.
  const dictationStart = useRef(0);
  const dictation = useDictation({
    onText: useCallback((text: string) => {
      setQuery(text);
      setActiveId(null);
    }, []),
    onFinal: useCallback(
      (text: string) => ask(text, true, dictationStart.current || Date.now()),
      [ask],
    ),
  });

  // Atalho ⌘K / Ctrl+K e os botões do menu (eventos).
  useEffect(() => {
    if (!dialog) return;
    const show = () => {
      setQuery("");
      setActiveId(null);
      setAsked(null);
      setOpen(true);
      if (!dialog.open) dialog.showModal();
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        show();
      }
    };
    const onCreate = () => setCreating(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, show);
    window.addEventListener(OPEN_QUICK_CREATE_EVENT, onCreate);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, show);
      window.removeEventListener(OPEN_QUICK_CREATE_EVENT, onCreate);
    };
  }, [dialog]);

  // Quem pode cadastrar projeto vê o atalho "Novo projeto" (lido uma vez, ao abrir).
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/busca/projetos", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          body: {
            canCreateProject?: boolean;
            concierge?: "ready" | "off";
          } | null,
        ) => {
          setCanCreateProject(Boolean(body?.canCreateProject));
          setConciergeState(body?.concierge ?? null);
        },
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [open]);

  // Busca com uma pausa curta depois da digitação; a resposta velha é descartada.
  const term = query.trim();
  const searchable = !asked && term.length >= 2 && term.length <= SEARCH_MAX;
  useEffect(() => {
    if (!open || !searchable) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/busca?q=${encodeURIComponent(term)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (res) => {
          const body = await res.json();
          setFound(
            res.ok
              ? { q: term, data: body as SearchResult }
              : { q: term, error: String(body?.error ?? "Falha na busca.") },
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setFound({ q: term, error: "Falha na busca. Tente de novo." });
          }
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, term, searchable]);

  const current = found && found.q === term ? found : null;
  const results = current && "data" in current ? current.data : null;
  const searchError = current && "error" in current ? current.error : null;
  const searching = searchable && current === null;
  const items = useMemo(
    () =>
      paletteItems({
        query: term,
        results,
        canCreateProject,
        dark,
        concierge: conciergeState,
      }),
    [term, results, canCreateProject, dark, conciergeState],
  );
  const activeIndex = Math.max(
    0,
    items.findIndex((i) => i.id === activeId),
  );
  const active = items[activeIndex] ?? null;
  const optionId = (item: PaletteItem) => `${listId}-${item.id}`;

  useEffect(() => {
    if (!active) return;
    document
      .getElementById(`${listId}-${active.id}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  function choose(item: PaletteItem) {
    if (item.action === "concierge") {
      ask(term, false, Date.now());
      return;
    }
    dialog?.close();
    if (item.action === "nova-tarefa") setCreating(true);
    else if (item.action === "tema") setTheme(dark ? "claro" : "escuro");
    else if (item.action === "atalhos") openShortcuts();
    else if (item.href) router.push(item.href);
  }

  const groups: { name: PaletteItem["group"]; items: PaletteItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }

  return (
    <>
      <dialog
        ref={setDialog}
        aria-label="Buscar no Hub"
        onClose={() => setOpen(false)}
        className="mx-auto mt-[10vh] w-[min(94vw,40rem)] max-w-none rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-navy-3/50"
      >
        {open ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-line px-4">
              <Search aria-hidden="true" className="size-4 text-caption" />
              <input
                autoFocus
                // Na prévia do Concierge não há lista: o campo vira texto simples.
                role={asked ? undefined : "combobox"}
                aria-expanded={asked ? undefined : "true"}
                aria-controls={asked ? undefined : listId}
                aria-autocomplete={asked ? undefined : "list"}
                aria-activedescendant={
                  !asked && active ? optionId(active) : undefined
                }
                aria-label={
                  asked ? "Pedido ao Concierge" : "Buscar ou pedir ao Concierge"
                }
                placeholder={
                  dictation.listening
                    ? "Ouvindo…"
                    : asked
                      ? "Pedido ao Concierge"
                      : "Buscar ou pedir ao Concierge"
                }
                value={query}
                maxLength={500}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveId(null);
                }}
                onKeyDown={(event) => {
                  if (asked) {
                    if (event.key === "Enter" && term.length >= CONCIERGE_MIN) {
                      event.preventDefault();
                      ask(term, false, Date.now());
                    }
                    return;
                  }
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const next = step(
                      activeIndex,
                      items.length,
                      event.key === "ArrowDown" ? 1 : -1,
                    );
                    setActiveId(items[next]?.id ?? null);
                  } else if (event.key === "Enter" && active) {
                    event.preventDefault();
                    choose(active);
                  }
                }}
                className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-caption"
              />
              {searching ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin text-caption"
                />
              ) : null}
              {canDictate && conciergeState ? (
                <button
                  type="button"
                  aria-label="Ditar o pedido ao Concierge"
                  aria-pressed={dictation.listening}
                  title={
                    dictation.listening ? "Parar o ditado" : "Ditar o pedido"
                  }
                  onClick={() => {
                    if (dictation.listening) {
                      dictation.stop();
                    } else {
                      dictationStart.current = Date.now();
                      dictation.start();
                    }
                  }}
                  className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                    dictation.listening
                      ? "bg-brand text-navy"
                      : "text-ink-2 hover:bg-off"
                  }`}
                >
                  {dictation.listening ? (
                    <MicOff aria-hidden="true" className="size-4" />
                  ) : (
                    <Mic aria-hidden="true" className="size-4" />
                  )}
                </button>
              ) : null}
              <kbd className="hidden rounded border border-line px-1.5 font-mono text-[11px] text-caption sm:inline">
                Esc
              </kbd>
            </div>
            <div aria-live="polite" className="empty:hidden">
              {dictation.listening ? (
                <p className="px-4 pt-2 text-xs text-ink-2">
                  Ouvindo… fale o pedido e pare: o Concierge mostra a prévia.
                </p>
              ) : dictation.error ? (
                <p className="px-4 pt-2 text-sm text-danger-fg">
                  {dictation.error}
                </p>
              ) : null}
            </div>
            {asked ? (
              <ConciergePanel
                request={asked.request}
                result={asked.result}
                onBack={() => setAsked(null)}
                onRetry={() =>
                  ask(asked.request.text, asked.request.voice, Date.now())
                }
                onClose={() => dialog?.close()}
              />
            ) : (
              <div
                id={listId}
                role="listbox"
                aria-label="Resultados"
                className="max-h-[min(60vh,28rem)] overflow-y-auto p-2"
              >
                {groups.map((group) => (
                  <div
                    key={group.name}
                    role="group"
                    aria-label={group.name}
                    className="flex flex-col"
                  >
                    <div
                      role="presentation"
                      className="px-2 pt-2 pb-1 font-mono text-[10px] tracking-[0.12em] text-caption uppercase"
                    >
                      {group.name}
                    </div>
                    {group.items.map((item) => {
                      const selected = item.id === active?.id;
                      return (
                        <div
                          key={item.id}
                          id={optionId(item)}
                          role="option"
                          aria-selected={selected}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseMove={() => setActiveId(item.id)}
                          onClick={() => choose(item)}
                          className={`flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm ${
                            selected ? "bg-brand-soft/20 text-navy" : "text-ink"
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {item.label}
                          </span>
                          {item.hint ? (
                            // Na opção escolhida, o cinza fica mais forte para manter o
                            // contraste sobre o laranja (tema escuro).
                            <span
                              className={`shrink-0 font-mono text-xs ${
                                selected ? "text-ink-2" : "text-caption"
                              }`}
                            >
                              {item.hint}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
                {term.length >= 2 && results && items.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-ink-2">
                    Nada encontrado para “{term}”.
                  </p>
                ) : null}
                {searchError ? (
                  <p role="alert" className="px-3 py-3 text-sm text-danger-fg">
                    {searchError}
                  </p>
                ) : null}
                {term.length === 1 ? (
                  <p className="px-3 py-2 text-xs text-caption">
                    Digite mais uma letra para buscar tarefas e projetos.
                  </p>
                ) : null}
              </div>
            )}
            <p className="hidden border-t border-line px-4 py-2 text-xs text-caption sm:block">
              {asked
                ? "Enter pede de novo ao Concierge, Esc fecha. Nada é feito sem você confirmar."
                : "Setas para escolher, Enter para abrir, Esc para fechar. Uma frase vira pedido ao Concierge. Atalho: ⌘K ou Ctrl+K."}
            </p>
          </div>
        ) : null}
      </dialog>
      <QuickCreateDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
