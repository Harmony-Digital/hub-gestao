"use client";

import { useActionState, useId } from "react";
import { LoaderCircle } from "lucide-react";
import { ErrorNote, Field, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE } from "@/lib/action-state";
import {
  displayFieldValue,
  type CustomFieldKind,
} from "@/modules/tasks/custom-field-kinds";
import { salvarCamposTarefa } from "./actions";

type FieldItem = {
  id: string;
  name: string;
  kind: CustomFieldKind;
  options: string[];
};

/** Campos personalizados da tarefa no painel: um campo por tipo, salvos juntos. */
export function CustomFieldsForm({
  code,
  version,
  fields,
  values,
}: {
  code: string;
  version: number;
  fields: FieldItem[];
  values: Record<string, string>;
}) {
  const [state, action, pending] = useActionState(salvarCamposTarefa, IDLE);
  const submit = useSubmit(action);
  const ids = useId();
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="version" value={version} />
      <fieldset
        disabled={pending}
        className="grid min-w-0 gap-3 sm:grid-cols-2"
      >
        {fields.map((f) => {
          const id = `${ids}-${f.id}`;
          const name = `field.${f.id}`;
          const value = values[f.name] ?? "";
          return (
            <Field key={f.id} id={id} label={f.name}>
              {f.kind === "select" ? (
                <select
                  id={id}
                  name={name}
                  defaultValue={value}
                  className={inputClass}
                >
                  <option value="">Sem valor</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                  {value && !f.options.includes(value) ? (
                    <option value={value}>{value}</option>
                  ) : null}
                </select>
              ) : (
                <input
                  id={id}
                  name={name}
                  type={
                    f.kind === "date"
                      ? "date"
                      : f.kind === "url"
                        ? "url"
                        : "text"
                  }
                  inputMode={f.kind === "number" ? "decimal" : undefined}
                  maxLength={500}
                  defaultValue={
                    f.kind === "number" && value
                      ? displayFieldValue("number", value)
                      : value
                  }
                  placeholder={
                    f.kind === "url"
                      ? "https://"
                      : f.kind === "number"
                        ? "Ex.: 1.250 ou 12,5"
                        : undefined
                  }
                  className={inputClass}
                />
              )}
            </Field>
          );
        })}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Salvar campos
        </Button>
        <span aria-live="polite" className="text-xs text-ok-fg">
          {state.status === "ok" ? state.message : null}
        </span>
      </div>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
    </form>
  );
}
