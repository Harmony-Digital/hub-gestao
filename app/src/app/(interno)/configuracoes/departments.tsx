"use client";

import { useActionState, useId } from "react";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { ErrorNote, Field, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import { removerDepartamento, salvarDepartamento } from "./actions";

/** Cor padrão de departamento novo (a mesma do banco). */
const DEFAULT_COLOR = "#4A5061";

type Department = { id: string; name: string; color: string };

/**
 * "Novo departamento" ou "Editar" (RF-27): o nome e a cor. O endereço do departamento
 * nasce do nome e não muda ao renomear.
 */
export function DepartmentButton({ department }: { department?: Department }) {
  return department ? (
    <FormDialog
      label="Editar"
      accessibleLabel={`Editar o departamento ${department.name}`}
      icon={<Pencil aria-hidden="true" />}
      variant="ghost"
      size="sm"
      title="Editar departamento"
      description={department.name}
    >
      {(close) => <DepartmentForm department={department} onDone={close} />}
    </FormDialog>
  ) : (
    <FormDialog
      label="Novo departamento"
      icon={<Plus aria-hidden="true" />}
      variant="outline"
      size="sm"
      title="Novo departamento"
      description="Aparece em Departamentos, nas frentes e no cadastro dos agentes."
    >
      {(close) => <DepartmentForm onDone={close} />}
    </FormDialog>
  );
}

function DepartmentForm({
  department,
  onDone,
}: {
  department?: Department;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await salvarDepartamento(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const id = useId();
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {department ? (
        <input type="hidden" name="department_id" value={department.id} />
      ) : null}
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <Field id={`${id}-name`} label="Nome">
          <input
            id={`${id}-name`}
            name="name"
            required
            maxLength={80}
            autoFocus
            autoComplete="off"
            defaultValue={department?.name ?? ""}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-color`} label="Cor">
          <input
            id={`${id}-color`}
            name="color"
            type="color"
            defaultValue={department?.color ?? DEFAULT_COLOR}
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
          {department ? "Salvar o departamento" : "Criar o departamento"}
        </Button>
      </div>
    </form>
  );
}

/** Remover só aparece para departamento sem uso; ainda assim, pede confirmação. */
export function RemoveDepartmentButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [state, action, pending] = useActionState(removerDepartamento, IDLE);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const ok = window.confirm(
          `Remover o departamento ${name}? Nenhum projeto, frente ou agente usa ele hoje. As visões salvas dele somem junto.`,
        );
        if (!ok) event.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="department_id" value={id} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Remover o departamento ${name}`}
        className="text-danger-fg"
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Trash2 aria-hidden="true" />
        )}
        Remover
      </Button>
      {state.status === "error" ? (
        <span role="alert" className="text-xs text-danger-fg">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
