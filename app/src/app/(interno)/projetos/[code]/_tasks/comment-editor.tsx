"use client";

import {
  useActionState,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  AtSign,
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  LoaderCircle,
  Send,
} from "lucide-react";
import { ErrorNote, textareaClass, useSubmit } from "@/components/forms";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { comentarTarefa } from "./actions";
import { IDLE, type ActionState, type Mention } from "./form";

type Person = { type: "user" | "agent"; id: string; name: string };

type ToolKind = "bold" | "italic" | "list" | "link" | "code" | "mention";

/** Botões da barra de formatação (o que cada um faz fica em applyTool). */
const TOOLS: { kind: ToolKind; label: string; icon: typeof Bold }[] = [
  { kind: "bold", label: "Negrito", icon: Bold },
  { kind: "italic", label: "Itálico", icon: Italic },
  { kind: "list", label: "Lista", icon: List },
  { kind: "link", label: "Link", icon: LinkIcon },
  { kind: "code", label: "Código", icon: Code },
  { kind: "mention", label: "Citar alguém", icon: AtSign },
];

/** "Fábio" e "fabio" se acham: sem acento e sem caixa. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** O @ que está sendo digitado antes do cursor (sem quebra de linha, até 30 letras). */
function mentionAt(
  text: string,
  caret: number,
): { start: number; term: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const term = before.slice(at + 1);
  if (term.length > 30 || /[\n@]/.test(term)) return null;
  return { start: at, term };
}

/**
 * Comentário em Markdown, com negrito, itálico, lista, link e código, pré-visualização e
 * @menção: a pessoa citada recebe aviso na caixa de entrada.
 */
export function CommentForm({
  code,
  people,
}: {
  code: string;
  people: Person[];
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const ids = useId();
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [picked, setPicked] = useState<Person[]>([]);
  const [query, setQuery] = useState<{ start: number; term: string } | null>(
    null,
  );
  const [active, setActive] = useState(0);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, data: FormData) => {
      const result = await comentarTarefa(previous, data);
      if (result.status === "ok") {
        setText("");
        setPicked([]);
        setTab("write");
      }
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);

  const suggestions = useMemo(() => {
    if (!query) return [];
    const term = fold(query.term);
    return people.filter((p) => fold(p.name).includes(term)).slice(0, 6);
  }, [people, query]);

  // Só vale a menção cujo "@Nome" continua no texto.
  const mentions: Mention[] = picked
    .filter((p) => text.includes(`@${p.name}`))
    .map(({ type, id }) => ({ type, id }));

  const update = (value: string, caret: number) => {
    setText(value);
    setQuery(mentionAt(value, caret));
    setActive(0);
  };

  const pick = (person: Person) => {
    const el = area.current;
    if (!el || !query) return;
    const caret = el.selectionStart;
    const insert = `@${person.name} `;
    const next = text.slice(0, query.start) + insert + text.slice(caret);
    setText(next);
    setQuery(null);
    setPicked((list) =>
      list.some((p) => p.id === person.id) ? list : [...list, person],
    );
    const pos = query.start + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!query || suggestions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(suggestions[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery(null);
    }
  };

  /** Envolve a seleção (ou um texto de exemplo) com as marcas do Markdown. */
  const wrap = (before: string, after: string, sample: string) => {
    const el = area.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const chosen = text.slice(start, end) || sample;
    setText(text.slice(0, start) + before + chosen + after + text.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(
        start + before.length,
        start + before.length + chosen.length,
      );
    });
  };
  const listify = () => {
    const el = area.current;
    if (!el) return;
    const start = text.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const end = el.selectionEnd;
    const block = text
      .slice(start, end)
      .split("\n")
      .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
      .join("\n");
    setText(text.slice(0, start) + block + text.slice(end));
    requestAnimationFrame(() => el.focus());
  };

  const mention = () => {
    const el = area.current;
    if (!el) return;
    const pos = el.selectionStart;
    const prefix = pos > 0 && !/\s/.test(text[pos - 1]) ? " @" : "@";
    const next = text.slice(0, pos) + prefix + text.slice(pos);
    update(next, pos + prefix.length);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos + prefix.length, pos + prefix.length);
    });
  };
  const applyTool = (kind: ToolKind) => {
    if (kind === "bold") wrap("**", "**", "negrito");
    else if (kind === "italic") wrap("_", "_", "itálico");
    else if (kind === "list") listify();
    else if (kind === "link") wrap("[", "](https://)", "texto do link");
    else if (kind === "code") wrap("`", "`", "código");
    else mention();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="body" value={text} />
      <input type="hidden" name="mentions" value={JSON.stringify(mentions)} />

      <div className="flex flex-wrap items-center gap-1 border-b border-line pb-1">
        <div role="tablist" aria-label="Comentário" className="flex gap-1">
          {(["write", "preview"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                tab === key
                  ? "bg-off-2 text-navy"
                  : "text-caption hover:text-navy"
              }`}
            >
              {key === "write" ? "Escrever" : "Pré-visualizar"}
            </button>
          ))}
        </div>
        {tab === "write" ? (
          <div className="ml-auto flex gap-0.5">
            {TOOLS.map(({ kind, label, icon: Icon }) => (
              <Button
                key={kind}
                type="button"
                variant="ghost"
                size="icon-sm"
                title={label}
                aria-label={label}
                onClick={() => applyTool(kind)}
              >
                <Icon aria-hidden="true" />
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {tab === "write" ? (
        <div className="relative">
          <label htmlFor={`${ids}-texto`} className="sr-only">
            Novo comentário
          </label>
          <textarea
            id={`${ids}-texto`}
            ref={area}
            value={text}
            rows={4}
            maxLength={10000}
            disabled={pending}
            onChange={(e) =>
              update(e.currentTarget.value, e.currentTarget.selectionStart)
            }
            onKeyDown={onKeyDown}
            onClick={(e) =>
              setQuery(mentionAt(text, e.currentTarget.selectionStart))
            }
            onBlur={() => setTimeout(() => setQuery(null), 150)}
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls={`${ids}-sugestoes`}
            aria-autocomplete="list"
            aria-activedescendant={
              suggestions.length > 0 ? `${ids}-s${active}` : undefined
            }
            placeholder="Escreva para a equipe e os agentes. Use @ para citar alguém. Comentário de tarefa é sempre interno."
            className={textareaClass}
          />
          {suggestions.length > 0 ? (
            <ul
              id={`${ids}-sugestoes`}
              role="listbox"
              aria-label="Pessoas e agentes"
              className="absolute top-full left-0 z-10 mt-1 w-64 overflow-hidden rounded-lg border border-line bg-paper py-1 shadow-lg"
            >
              {suggestions.map((p, i) => (
                <li
                  key={`${p.type}:${p.id}`}
                  id={`${ids}-s${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(p);
                  }}
                  className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm ${
                    i === active ? "bg-off-2 text-navy" : "text-ink"
                  }`}
                >
                  {p.name}
                  <span className="text-xs text-caption">
                    {p.type === "agent" ? "agente" : "pessoa"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="min-h-24 rounded-lg border border-line bg-paper px-3 py-2">
          {text.trim() ? (
            <Markdown text={text} />
          ) : (
            <p className="text-sm text-caption">Nada para mostrar ainda.</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-caption">
          {mentions.length > 0
            ? `Cita: ${picked
                .filter((p) => mentions.some((m) => m.id === p.id))
                .map((p) => p.name)
                .join(", ")}. Pessoas citadas recebem aviso.`
            : "Markdown: **negrito**, _itálico_, - lista, [link](https://…)"}
        </p>
        <Button type="submit" size="lg" disabled={pending || !text.trim()}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Send aria-hidden="true" />
          )}
          Comentar
        </Button>
      </div>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : null}
      </div>
    </form>
  );
}
