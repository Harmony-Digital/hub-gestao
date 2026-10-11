"use client";

import { useState, useTransition } from "react";
import { CircleCheck, LoaderCircle, Mail } from "lucide-react";
import { ErrorNote } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import { enviarEmailTeste } from "./actions";

/** "Enviar um e-mail de teste para mim": só o dono, só para o próprio endereço. */
export function EmailTestButton({ on }: { on: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>(IDLE);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={!on || pending}
          onClick={() =>
            startTransition(async () => setState(await enviarEmailTeste()))
          }
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Mail aria-hidden="true" />
          )}
          Enviar um e-mail de teste para mim
        </Button>
      </div>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : state.status === "ok" && state.message ? (
          <p className="flex items-start gap-2 text-sm text-ok-fg">
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
