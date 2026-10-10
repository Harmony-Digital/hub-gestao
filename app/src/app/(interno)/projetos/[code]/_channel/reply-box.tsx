"use client";

import { useActionState, useId, useState } from "react";
import { CircleCheck, LoaderCircle, Send } from "lucide-react";
import { ErrorNote, textareaClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { responderAoCliente } from "./actions";
import { REPLY_IDLE, REPLY_MAX, type ReplyState } from "./form";

/** Responder ao cliente no canal: o texto aparece para ele no portal. */
export function ReplyBox({ projectCode }: { projectCode: string }) {
  const id = useId();
  const [round, setRound] = useState(0);
  const [state, action, pending] = useActionState(
    async (previous: ReplyState, form: FormData) => {
      const result = await responderAoCliente(previous, form);
      if (result.status === "ok") setRound((r) => r + 1);
      return result;
    },
    REPLY_IDLE,
  );
  const submit = useSubmit(action);
  return (
    <div className="flex flex-col gap-2">
      <form key={round} onSubmit={submit} className="flex flex-col gap-2">
        <input type="hidden" name="project" value={projectCode} />
        <label htmlFor={`${id}-body`} className="text-sm font-medium text-navy">
          Responder ao cliente
        </label>
        <textarea
          id={`${id}-body`}
          name="body"
          required
          rows={3}
          maxLength={REPLY_MAX}
          disabled={pending}
          aria-describedby={`${id}-hint`}
          className={textareaClass}
        />
        <p id={`${id}-hint`} className="text-xs text-caption">
          O cliente vê esta mensagem no portal, com o seu nome.
        </p>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Send aria-hidden="true" />
            )}
            Enviar ao cliente
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : state.status === "ok" ? (
          <p className="flex items-start gap-2 rounded-lg bg-ok-soft p-3 text-sm text-ok-fg">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            {state.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
