"use client";

import { useActionState, useId } from "react";
import { CircleCheck, LoaderCircle, Mail } from "lucide-react";
import { ErrorNote, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { pedirLinkPorEmail } from "../actions";
import { MESSAGE_IDLE } from "../message-form";

/**
 * "Receber um link novo" (RF-05): o contato que já tem o acesso liberado pede o link
 * pelo e-mail do convite. A resposta é sempre a mesma, exista ou não o e-mail.
 */
export function LinkRequestForm() {
  const id = useId();
  const [state, action, pending] = useActionState(
    pedirLinkPorEmail,
    MESSAGE_IDLE,
  );
  const submit = useSubmit(action);
  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4"
    >
      <h2
        id={`${id}-titulo`}
        className="font-heading text-base font-semibold text-navy"
      >
        Receber um link novo
      </h2>
      {state.status === "ok" ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg bg-ok-soft p-3 text-sm text-ok-fg"
        >
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor={`${id}-email`} className="text-sm text-ink-2">
            Escreva o e-mail em que você recebeu o convite. Se o seu acesso
            estiver liberado, o link chega por lá.
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            disabled={pending}
            className={inputClass}
          />
          {state.status === "error" ? (
            <ErrorNote message={state.message} />
          ) : null}
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Mail aria-hidden="true" />
              )}
              Mandar o link
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
