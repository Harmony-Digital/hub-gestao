"use client";

import { useActionState, useId } from "react";
import { LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { ErrorNote, Field, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import { removerEtiqueta, salvarEtiqueta } from "./actions";

type Label = { id: string; name: string; color: string };

/** "Editar" a etiqueta (RF-18): o nome e a cor valem em todas as tarefas. */
export function LabelButton({ label }: { label: Label }) {
  return (
    <FormDialog
      label="Editar"
      accessibleLabel={`Editar a etiqueta ${label.name}`}
      icon={<Pencil aria-hidden="true" />}
      variant="ghost"
      size="sm"
      title="Editar etiqueta"
      description={label.name}
    >
      {(close) => <LabelForm label={label} onDone={close} />}
    </FormDialog>
  );
}

function LabelForm({ label, onDone }: { label: Label; onDone: () => void }) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await salvarEtiqueta(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const id = useId();
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="label_id" value={label.id} />
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <Field id={`${id}-name`} label="Nome">
          <input
            id={`${id}-name`}
            name="name"
            required
            maxLength={40}
            autoFocus
            autoComplete="off"
            defaultValue={label.name}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-color`} label="Cor">
          <input
            id={`${id}-color`}
            name="color"
            type="color"
            defaultValue={label.color}
            className="h-10 w-20 cursor-pointer rounded-lg border border-line bg-paper p-1"
          />
        </Field>
      </fieldset>
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
          onClick={onDone}
        >
          Cancelar
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Salvar a etiqueta
        </Button>
      </div>
    </form>
  );
}

/** Remover tira a etiqueta de todas as tarefas; pede confirmação. */
export function RemoveLabelButton({
  id,
  name,
  uses,
}: {
  id: string;
  name: string;
  uses: number;
}) {
  const [state, action, pending] = useActionState(removerEtiqueta, IDLE);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const ok = window.confirm(
          uses > 0
            ? `Remover a etiqueta ${name}? Ela sai de ${uses === 1 ? "1 tarefa" : `${uses} tarefas`}.`
            : `Remover a etiqueta ${name}?`,
        );
        if (!ok) event.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="label_id" value={id} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Remover a etiqueta ${name}`}
        className="text-danger-fg"
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Trash2 aria-hidden="true" />
        )}
      </Button>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
    </form>
  );
}
