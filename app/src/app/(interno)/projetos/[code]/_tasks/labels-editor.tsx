"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { LoaderCircle, Plus, X } from "lucide-react";
import { ErrorNote, inputClass } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE } from "@/lib/action-state";
import { salvarEtiquetas } from "./actions";

type Label = { name: string; color: string };

/**
 * Etiquetas da tarefa no painel (RF-18): tirar com o X e pôr pelo campo, que sugere as
 * do workspace; nome novo vira etiqueta nova. Cada mudança grava a lista inteira.
 */
export function LabelsEditor({
  code,
  version,
  labels,
  options,
}: {
  code: string;
  version: number;
  labels: Label[];
  /** Todas as etiquetas do workspace, para sugerir. */
  options: Label[];
}) {
  const id = useId();
  const [state, action] = useActionState(salvarEtiquetas, IDLE);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState("");
  const save = (names: string[]) => {
    const form = new FormData();
    form.set("code", code);
    form.set("version", String(version));
    for (const n of names) form.append("label", n);
    startTransition(() => action(form));
  };
  const current = labels.map((l) => l.name);
  const add = () => {
    const name = draft.replace(/\s+/g, " ").trim();
    if (!name) return;
    const known = options.find(
      (o) => o.name.toLowerCase() === name.toLowerCase(),
    );
    const next = known?.name ?? name;
    if (current.some((c) => c.toLowerCase() === next.toLowerCase())) {
      setDraft("");
      return;
    }
    setDraft("");
    save([...current, next]);
  };
  const suggestions = options.filter(
    (o) => !current.some((c) => c.toLowerCase() === o.name.toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-2">
      {labels.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Etiquetas da tarefa">
          {labels.map((l) => (
            <li
              key={l.name}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-paper py-0.5 pr-0.5 pl-2 text-sm text-ink-2"
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: l.color }}
              />
              {l.name}
              <button
                type="button"
                disabled={pending}
                onClick={() => save(current.filter((c) => c !== l.name))}
                aria-label={`Tirar a etiqueta ${l.name}`}
                className="inline-flex size-6 items-center justify-center rounded-full text-caption hover:bg-off hover:text-navy"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-caption">Sem etiquetas.</p>
      )}
      {labels.length < 10 ? (
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-nova`} className="sr-only">
            Pôr uma etiqueta
          </label>
          <input
            id={`${id}-nova`}
            list={`${id}-opcoes`}
            value={draft}
            maxLength={40}
            disabled={pending}
            placeholder="Pôr uma etiqueta"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className={`${inputClass} max-w-64`}
          />
          <datalist id={`${id}-opcoes`}>
            {suggestions.map((o) => (
              <option key={o.name} value={o.name} />
            ))}
          </datalist>
          <Button
            type="button"
            variant="outline"
            disabled={pending || !draft.trim()}
            onClick={add}
          >
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            Pôr
          </Button>
        </div>
      ) : null}
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
    </div>
  );
}
