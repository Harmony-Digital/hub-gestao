"use client";

import { useActionState, useId, useState } from "react";
import { CircleCheck, LoaderCircle, Send } from "lucide-react";
import { ErrorNote, textareaClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { escreverParaEquipe } from "../actions";
import { MESSAGE_IDLE, MESSAGE_MAX, type MessageState } from "../message-form";

/** "Escreva para a equipe": a mensagem entra no canal do projeto e a equipe é avisada. */
export function MessageBox({ projectCode }: { projectCode: string }) {
  const id = useId();
  const [round, setRound] = useState(0);
  const [state, action, pending] = useActionState(
    async (previous: MessageState, form: FormData) => {
      const result = await escreverParaEquipe(previous, form);
      // Enviou: o campo recomeça vazio (o aviso de enviado fica embaixo).
      if (result.status === "ok") setRound((r) => r + 1);
      return result;
    },
    MESSAGE_IDLE,
  );
  const submit = useSubmit(action);
  return (
    <div className="flex flex-col gap-2">
      <form key={round} onSubmit={submit} className="flex flex-col gap-2">
        <input type="hidden" name="project" value={projectCode} />
        <label htmlFor={`${id}-body`} className="text-sm font-medium text-navy">
          Escreva para a equipe
        </label>
        <textarea
          id={`${id}-body`}
          name="body"
          required
          rows={4}
          maxLength={MESSAGE_MAX}
          disabled={pending}
          className={textareaClass}
        />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Send aria-hidden="true" />
            )}
            Enviar
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
