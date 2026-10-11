"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { LayoutTemplate, LoaderCircle } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import {
  ErrorNote,
  Field,
  inputClass,
  textareaClass,
  useSubmit,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import { salvarComoModelo } from "./actions";

/** "Salvar como modelo" do Editar projeto: o esqueleto do projeto vira um modelo. */
export function SaveAsTemplate({
  projectCode,
  projectName,
}: {
  projectCode: string;
  projectName: string;
}) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <FormDialog
        label="Salvar como modelo"
        icon={<LayoutTemplate aria-hidden="true" />}
        variant="outline"
        size="lg"
        title="Salvar como modelo"
        description="Marcos, frentes com o departamento, tarefas e critérios de aceite, sem códigos e com tudo desmarcado. Os departamentos do projeto vão junto."
      >
        {(close) => (
          <SaveForm
            projectCode={projectCode}
            projectName={projectName}
            onDone={(message) => {
              setDone(message);
              close();
            }}
            onCancel={close}
          />
        )}
      </FormDialog>
      <p aria-live="polite" className="text-sm text-ok-fg">
        {done ? (
          <>
            {done}{" "}
            <Link
              href="/modelos"
              className="font-semibold text-brand-strong hover:text-navy"
            >
              Abrir Modelos de projeto
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}

function SaveForm({
  projectCode,
  projectName,
  onDone,
  onCancel,
}: {
  projectCode: string;
  projectName: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await salvarComoModelo(previous, form);
      if (result.status === "ok") onDone(result.message ?? "Modelo criado.");
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const id = useId();
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="project" value={projectCode} />
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <Field id={`${id}-name`} label="Nome do modelo">
          <input
            id={`${id}-name`}
            name="name"
            required
            maxLength={120}
            autoFocus
            defaultValue={projectName}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-description`} label="Descrição (opcional)">
          <textarea
            id={`${id}-description`}
            name="description"
            rows={2}
            maxLength={1000}
            className={textareaClass}
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
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Salvar o modelo
        </Button>
      </div>
    </form>
  );
}
