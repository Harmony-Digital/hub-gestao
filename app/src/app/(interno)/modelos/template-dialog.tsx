"use client";

import { useActionState, useId } from "react";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
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
import { removerModelo, salvarModelo } from "./actions";

export type TemplateInitial = {
  id: string;
  name: string;
  description: string | null;
  markdown: string;
  departments: string[];
};

const STARTER = `## M1 — Descoberta

### Briefing

Departamento: Estratégia.

- [ ] Fazer a reunião de briefing com o cliente
  - [ ] Agendar a reunião

### GATE M1 (critérios de aceite)

- [ ] Briefing aprovado pelo cliente
`;

/** "Novo modelo" (sem modelo) ou "Editar" (com o modelo), numa janela. */
export function TemplateButton({
  template,
  departments,
}: {
  template?: TemplateInitial;
  departments: { slug: string; name: string }[];
}) {
  return (
    <FormDialog
      label={template ? "Editar" : "Novo modelo"}
      accessibleLabel={
        template ? `Editar o modelo ${template.name}` : undefined
      }
      icon={
        template ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />
      }
      variant={template ? "ghost" : "default"}
      size={template ? "sm" : "lg"}
      title={template ? "Editar modelo" : "Novo modelo de projeto"}
      description={
        template
          ? template.name
          : "O esqueleto de um projeto: marcos, frentes com o departamento, tarefas e os critérios de aceite."
      }
      wide
    >
      {(close) => (
        <TemplateForm
          template={template}
          departments={departments}
          onDone={close}
        />
      )}
    </FormDialog>
  );
}

function TemplateForm({
  template,
  departments,
  onDone,
}: {
  template?: TemplateInitial;
  departments: { slug: string; name: string }[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await salvarModelo(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const id = useId();
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <Field id={`${id}-name`} label="Nome do modelo">
          <input
            id={`${id}-name`}
            name="name"
            required
            maxLength={120}
            autoFocus
            defaultValue={template?.name ?? ""}
            placeholder="Ex.: Site institucional"
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-description`} label="Descrição (opcional)">
          <textarea
            id={`${id}-description`}
            name="description"
            rows={2}
            maxLength={1000}
            defaultValue={template?.description ?? ""}
            className={textareaClass}
          />
        </Field>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="text-sm font-medium text-ink">
            Departamentos do projeto
          </legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {departments.map((d) => (
              <label
                key={d.slug}
                className="flex items-center gap-2 text-sm text-ink"
              >
                <input
                  type="checkbox"
                  name="departments"
                  value={d.slug}
                  defaultChecked={template?.departments.includes(d.slug)}
                  className="size-4 accent-[var(--color-brand)]"
                />
                {d.name}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          id={`${id}-markdown`}
          label="Esqueleto"
          hint="No formato do plan.md: “## M1 — Título” para o marco, “### Título” para a frente, a linha “Departamento: Nome.” logo abaixo dela, “- [ ] Tarefa” e, com recuo, a subtarefa; os itens do GATE viram critérios de aceite. Sem códigos de tarefa e com as caixas desmarcadas."
        >
          <textarea
            id={`${id}-markdown`}
            name="markdown"
            required
            rows={16}
            spellCheck={false}
            defaultValue={template?.markdown ?? STARTER}
            className={`${textareaClass} font-mono text-xs`}
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
          {template ? "Salvar o modelo" : "Criar modelo"}
        </Button>
      </div>
    </form>
  );
}

/** Remover, com a confirmação na janela. */
export function RemoveTemplateButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  return (
    <FormDialog
      label="Remover"
      accessibleLabel={`Remover o modelo ${name}`}
      icon={<Trash2 aria-hidden="true" />}
      variant="ghost"
      size="sm"
      title="Remover modelo"
      description={name}
    >
      {(close) => <RemoveForm id={id} name={name} onDone={close} />}
    </FormDialog>
  );
}

function RemoveForm({
  id,
  name,
  onDone,
}: {
  id: string;
  name: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await removerModelo(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-ink">
        Remover o modelo “{name}”? Os projetos já criados com ele não mudam. O
        histórico guarda o esqueleto, se precisar refazer.
      </p>
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
        <Button
          type="submit"
          variant="destructive"
          size="lg"
          disabled={pending}
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Remover o modelo
        </Button>
      </div>
    </form>
  );
}
