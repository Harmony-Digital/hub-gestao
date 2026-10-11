"use client";

import { useActionState, useId, useState } from "react";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import {
  ErrorNote,
  Field,
  inputClass,
  textareaClass,
  useSubmit,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import {
  CUSTOM_FIELD_KIND_LABEL,
  CUSTOM_FIELD_KINDS,
  type CustomFieldKind,
} from "@/modules/tasks/custom-field-kinds";
import { criarCampo, removerCampo, salvarCampo } from "./fields-actions";

export type FieldItem = {
  id: string;
  name: string;
  kind: CustomFieldKind;
  options: string[];
};

/** Campos personalizados das tarefas do projeto (Editar projeto; dono e administração). */
export function FieldsEditor({
  projectCode,
  fields,
}: {
  projectCode: string;
  fields: FieldItem[];
}) {
  return (
    <section
      aria-labelledby="campos-tarefas"
      className="flex max-w-4xl flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="campos-tarefas"
          className="font-heading text-base font-semibold text-navy"
        >
          Campos das tarefas
        </h2>
        <p className="text-sm text-ink-2">
          Campos próprios deste projeto nas tarefas: texto, número, seleção,
          data ou endereço. Aparecem no painel da tarefa e, pelo nome, para os
          agentes. O cliente não vê.
        </p>
      </div>
      {fields.length === 0 ? (
        <p className="text-sm text-ink-2">Nenhum campo ainda.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {fields.map((f) => (
            <FieldRow
              key={`${f.id}:${f.name}:${f.options.join("|")}`}
              field={f}
            />
          ))}
        </ul>
      )}
      <NewFieldForm projectCode={projectCode} />
    </section>
  );
}

function FieldRow({ field }: { field: FieldItem }) {
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-navy">{field.name}</span>
        <span className="text-xs text-ink-2">
          {CUSTOM_FIELD_KIND_LABEL[field.kind]}
          {field.kind === "select" ? `: ${field.options.join(", ")}` : ""}
        </span>
        {mode === "view" ? (
          <span className="ml-auto flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Editar o campo ${field.name}`}
              onClick={() => setMode("edit")}
            >
              <Pencil aria-hidden="true" />
              Editar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remover o campo ${field.name}`}
              className="text-danger-fg"
              onClick={() => setMode("remove")}
            >
              <Trash2 aria-hidden="true" />
              Remover
            </Button>
          </span>
        ) : null}
      </div>
      {mode === "edit" ? (
        <EditFieldForm field={field} onDone={() => setMode("view")} />
      ) : null}
      {mode === "remove" ? (
        <RemoveFieldForm field={field} onDone={() => setMode("view")} />
      ) : null}
    </li>
  );
}

function EditFieldForm({
  field,
  onDone,
}: {
  field: FieldItem;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await salvarCampo(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const id = useId();
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={field.id} />
      <fieldset
        disabled={pending}
        className="grid min-w-0 gap-3 sm:grid-cols-2"
      >
        <Field id={`${id}-nome`} label="Nome do campo">
          <input
            id={`${id}-nome`}
            name="name"
            required
            maxLength={60}
            autoFocus
            defaultValue={field.name}
            className={inputClass}
          />
        </Field>
        {field.kind === "select" ? (
          <Field
            id={`${id}-opcoes`}
            label="Opções"
            hint="Uma por linha. Opção em uso nas tarefas não sai."
          >
            <textarea
              id={`${id}-opcoes`}
              name="options"
              rows={4}
              defaultValue={field.options.join("\n")}
              className={textareaClass}
            />
          </Field>
        ) : null}
      </fieldset>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Salvar o campo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={onDone}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function RemoveFieldForm({
  field,
  onDone,
}: {
  field: FieldItem;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await removerCampo(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={field.id} />
      <p className="text-sm text-ink">
        Remover o campo “{field.name}”? Os valores dele nas tarefas saem junto;
        o histórico guarda que o campo existiu.
      </p>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={pending}
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Remover o campo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={onDone}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function NewFieldForm({ projectCode }: { projectCode: string }) {
  const [round, setRound] = useState(0);
  const [kind, setKind] = useState<CustomFieldKind>("text");
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await criarCampo(previous, form);
      if (result.status === "ok") {
        setRound((r) => r + 1);
        setKind("text");
      }
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const id = useId();
  return (
    <form
      key={round}
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl bg-off p-3"
    >
      <input type="hidden" name="project" value={projectCode} />
      <p className="text-sm font-semibold text-navy">Novo campo</p>
      <fieldset
        disabled={pending}
        className="grid min-w-0 gap-3 sm:grid-cols-2"
      >
        <Field id={`${id}-nome`} label="Nome do campo">
          <input
            id={`${id}-nome`}
            name="name"
            required
            maxLength={60}
            placeholder="Ex.: Canal"
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-tipo`} label="Tipo">
          <select
            id={`${id}-tipo`}
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value as CustomFieldKind)}
            className={inputClass}
          >
            {CUSTOM_FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {CUSTOM_FIELD_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        {kind === "select" ? (
          <Field
            id={`${id}-opcoes`}
            label="Opções"
            hint="Uma por linha, como WhatsApp, Site e Indicação."
          >
            <textarea
              id={`${id}-opcoes`}
              name="options"
              rows={4}
              className={textareaClass}
            />
          </Field>
        ) : null}
      </fieldset>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : state.status === "ok" ? (
          <p className="text-sm text-ok-fg">{state.message}</p>
        ) : null}
      </div>
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="self-start"
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Plus aria-hidden="true" />
        )}
        Criar campo
      </Button>
    </form>
  );
}
