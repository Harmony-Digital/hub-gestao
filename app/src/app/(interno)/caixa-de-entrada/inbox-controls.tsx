"use client";

import { useActionState } from "react";
import { Check, CheckCheck, CircleCheck, LoaderCircle } from "lucide-react";
import { ErrorNote, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE } from "@/lib/action-state";
import { marcarLidas, salvarPreferencias } from "./actions";

export function MarkReadButton({ id, label }: { id: string; label: string }) {
  const [, action, pending] = useActionState(marcarLidas, IDLE);
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit}>
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Marcar como lido: ${label}`}
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Check aria-hidden="true" />
        )}
        Lido
      </Button>
    </form>
  );
}

export function MarkAllButton() {
  const [state, action, pending] = useActionState(marcarLidas, IDLE);
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit} className="flex flex-col items-end gap-1">
      <input type="hidden" name="all" value="1" />
      <Button type="submit" variant="outline" size="lg" disabled={pending}>
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <CheckCheck aria-hidden="true" />
        )}
        Marcar todos como lidos
      </Button>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
    </form>
  );
}

export function PrefsForm({
  groups,
}: {
  groups: { key: string; label: string; enabled: boolean }[];
}) {
  const [state, action, pending] = useActionState(salvarPreferencias, IDLE);
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <fieldset disabled={pending} className="flex flex-col gap-2">
        <legend className="sr-only">Avisos que você recebe</legend>
        {groups.map((g) => (
          <label
            key={g.key}
            className="flex items-center gap-2 text-sm text-ink"
          >
            <input
              type="checkbox"
              name={g.key}
              defaultChecked={g.enabled}
              className="size-4 accent-[var(--color-brand)]"
            />
            {g.label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Salvar preferências
        </Button>
        <span aria-live="polite" className="text-sm">
          {state.status === "ok" && state.message ? (
            <span className="inline-flex items-center gap-1.5 text-ok-fg">
              <CircleCheck aria-hidden="true" className="size-4" />
              {state.message}
            </span>
          ) : null}
        </span>
      </div>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
    </form>
  );
}
