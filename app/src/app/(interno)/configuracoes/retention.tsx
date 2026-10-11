"use client";

import { useActionState, useId } from "react";
import { LoaderCircle } from "lucide-react";
import { ErrorNote, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE } from "@/lib/action-state";
import {
  RETENTION,
  type RetentionValues,
} from "@/modules/privacy/retention-rules";
import { salvarRetencao } from "./actions";

/** Prazos de retenção (PRD §12): o dono muda; a administração só vê. */
export function RetentionForm({
  values,
  editable,
}: {
  values: RetentionValues;
  editable: boolean;
}) {
  const [state, action, pending] = useActionState(salvarRetencao, IDLE);
  const submit = useSubmit(action);
  const id = useId();
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <fieldset
        disabled={!editable || pending}
        className="grid min-w-0 gap-x-6 gap-y-3 sm:grid-cols-2"
      >
        <legend className="sr-only">Prazos, em dias</legend>
        {RETENTION.map((r) => (
          <div key={r.key} className="flex min-w-0 flex-col gap-1">
            <label
              htmlFor={`${id}-${r.key}`}
              className="text-sm font-medium text-navy"
            >
              {r.label}
            </label>
            <span className="flex items-center gap-2">
              <input
                id={`${id}-${r.key}`}
                name={r.key}
                type="number"
                inputMode="numeric"
                required
                min={r.min}
                max={r.max}
                defaultValue={values[r.key]}
                aria-describedby={`${id}-${r.key}-faixa`}
                className={`${inputClass} w-28`}
              />
              <span
                id={`${id}-${r.key}-faixa`}
                className="text-xs text-caption"
              >
                dias (de {r.min} a {r.max}; padrão {r.default})
              </span>
            </span>
          </div>
        ))}
      </fieldset>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : state.status === "ok" && state.message ? (
          <p className="text-sm text-ok-fg">{state.message}</p>
        ) : null}
      </div>
      {editable ? (
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            Salvar os prazos
          </Button>
        </div>
      ) : (
        <p className="text-xs text-caption">Só o dono muda os prazos.</p>
      )}
    </form>
  );
}
