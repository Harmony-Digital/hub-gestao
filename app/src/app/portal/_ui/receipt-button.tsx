"use client";

import { useActionState, useState } from "react";
import { CircleCheck, LoaderCircle, PackageCheck } from "lucide-react";
import { ErrorNote } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { confirmarRecebimento } from "../actions";
import { MESSAGE_IDLE } from "../message-form";

/** "Confirmar recebimento", com a pergunta antes (o aceite continua com a Harmony). */
export function ReceiptButton({
  projectCode,
  milestoneId,
  title,
}: {
  projectCode: string;
  milestoneId: string;
  title: string;
}) {
  const [asking, setAsking] = useState(false);
  const [state, action, pending] = useActionState(
    confirmarRecebimento,
    MESSAGE_IDLE,
  );
  return (
    <div className="flex flex-col gap-2">
      {asking ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="project" value={projectCode} />
          <input type="hidden" name="milestone" value={milestoneId} />
          <span className="text-sm text-ink">
            Confirmar que você recebeu esta entrega?
          </span>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <CircleCheck aria-hidden="true" />
            )}
            Sim, recebi
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setAsking(false)}
          >
            Cancelar
          </Button>
        </form>
      ) : (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAsking(true)}
            aria-label={`Confirmar o recebimento de ${title}`}
          >
            <PackageCheck aria-hidden="true" />
            Confirmar recebimento
          </Button>
        </div>
      )}
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
