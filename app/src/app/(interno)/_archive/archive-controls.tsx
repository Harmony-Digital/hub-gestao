"use client";

import { useActionState } from "react";
import { Archive, LoaderCircle, RotateCcw } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { ErrorNote, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import { arquivar } from "./actions";
import type { ArchiveEntity } from "./form";

type Target = { entity: ArchiveEntity; ref: string };

function TargetFields({
  target,
  mode,
}: {
  target: Target;
  mode: "archive" | "restore";
}) {
  return (
    <>
      <input type="hidden" name="entity" value={target.entity} />
      <input type="hidden" name="ref" value={target.ref} />
      <input type="hidden" name="mode" value={mode} />
    </>
  );
}

/**
 * Confirmação de arquivar, para usar dentro de uma janela já aberta (Editar marco ou
 * frente) ou na janela do ArchiveButton. Diz antes o que acontece; se uma trava do
 * núcleo recusar (frente ligada, tarefa aberta…), o motivo aparece aqui.
 */
export function ArchiveConfirm({
  target,
  question,
  consequence,
  confirmLabel,
  onCancel,
  onDone,
}: {
  target: Target;
  question?: string;
  consequence: string;
  confirmLabel: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await arquivar(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TargetFields target={target} mode="archive" />
      <div className="flex flex-col gap-1.5 rounded-xl border border-danger/30 bg-danger-soft/40 p-4">
        {question ? (
          <p className="flex items-center gap-2 font-semibold text-navy">
            <Archive aria-hidden="true" className="size-4 shrink-0" />
            {question}
          </p>
        ) : null}
        <p className="text-sm text-ink-2">{consequence}</p>
      </div>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={pending}
          onClick={onCancel}
        >
          Voltar
        </Button>
        <Button
          type="submit"
          variant="destructive"
          size="lg"
          disabled={pending}
          autoFocus
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Archive aria-hidden="true" />
          )}
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

/** Botão Arquivar com a confirmação numa janela (projeto e cliente). */
export function ArchiveButton({
  target,
  label,
  title,
  consequence,
  confirmLabel,
}: {
  target: Target;
  label: string;
  title: string;
  consequence: string;
  confirmLabel: string;
}) {
  return (
    <FormDialog
      label={label}
      icon={<Archive aria-hidden="true" />}
      title={title}
    >
      {(close) => (
        <ArchiveConfirm
          target={target}
          consequence={consequence}
          confirmLabel={confirmLabel}
          onCancel={close}
          onDone={close}
        />
      )}
    </FormDialog>
  );
}

/** Restaurar não perde nada: vai direto, sem confirmação; a recusa aparece embaixo. */
export function RestoreButton({
  target,
  label = "Restaurar",
  accessibleLabel,
}: {
  target: Target;
  label?: string;
  accessibleLabel?: string;
}) {
  const [state, action, pending] = useActionState(arquivar, IDLE);
  const submit = useSubmit(action);
  return (
    <form onSubmit={submit} className="flex flex-col items-end gap-1">
      <TargetFields target={target} mode="restore" />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={accessibleLabel}
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <RotateCcw aria-hidden="true" />
        )}
        {label}
      </Button>
      {state.status === "error" ? (
        <p role="alert" className="max-w-xs text-right text-xs text-danger-fg">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
