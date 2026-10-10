"use client";

import { useActionState, useId } from "react";
import { LoaderCircle, Pause, Pencil, Play } from "lucide-react";
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
import { mudarStatusAgente, salvarAgente } from "./actions";
import { RolesField } from "./roles-field";

/** O agente como o formulário de edição precisa. */
export type AgentInitial = {
  id: string;
  name: string;
  department: string | null;
  mission: string | null;
  budgetUsdMonth: number;
  owner: string | null;
  ownerName: string | null;
  roles: string[];
};

export type AgentFormOptions = {
  departments: { slug: string; name: string }[];
  people: { id: string; name: string }[];
};

/** Valor do orçamento como aparece no campo (vírgula decimal, sem zeros sobrando). */
export function budgetText(value: number): string {
  return value === 0 ? "" : String(value).replace(".", ",");
}

export function EditarAgenteButton({
  agent,
  options,
}: {
  agent: AgentInitial;
  options: AgentFormOptions;
}) {
  return (
    <FormDialog
      label="Editar"
      accessibleLabel={`Editar o agente ${agent.name}`}
      icon={<Pencil aria-hidden="true" />}
      variant="ghost"
      size="sm"
      title="Editar agente"
      description={agent.name}
      wide
    >
      {(close) => <AgentForm agent={agent} options={options} onDone={close} />}
    </FormDialog>
  );
}

function AgentForm({
  agent,
  options,
  onDone,
}: {
  agent: AgentInitial;
  options: AgentFormOptions;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await salvarAgente(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const id = useId();
  // Responsável que saiu da equipe continua escolhido, para outra mudança não o apagar.
  const missingOwner =
    agent.owner !== null && !options.people.some((p) => p.id === agent.owner);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={agent.id} />
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <Field id={`${id}-name`} label="Nome do agente">
          <input
            id={`${id}-name`}
            name="name"
            required
            maxLength={80}
            autoFocus
            defaultValue={agent.name}
            className={inputClass}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-department`} label="Departamento">
            <select
              id={`${id}-department`}
              name="department"
              defaultValue={agent.department ?? ""}
              className={inputClass}
            >
              <option value="">Sem departamento</option>
              {options.departments.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-owner`} label="Responsável na equipe">
            <select
              id={`${id}-owner`}
              name="owner"
              defaultValue={agent.owner ?? ""}
              className={inputClass}
            >
              <option value="">Ninguém</option>
              {missingOwner ? (
                <option value={agent.owner ?? ""}>
                  {agent.ownerName ?? "Responsável atual"} (atual)
                </option>
              ) : null}
              {options.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id={`${id}-budget`}
            label="Orçamento de IA por mês (US$)"
            hint="Em branco ou 0: sem orçamento. Até 10.000."
          >
            <input
              id={`${id}-budget`}
              name="budget"
              inputMode="decimal"
              maxLength={9}
              defaultValue={budgetText(agent.budgetUsdMonth)}
              placeholder="Ex.: 20"
              className={inputClass}
            />
          </Field>
        </div>
        <Field
          id={`${id}-mission`}
          label="Missão (opcional)"
          hint="O que este agente faz e o que não faz. Aparece para a equipe."
        >
          <textarea
            id={`${id}-mission`}
            name="mission"
            rows={3}
            maxLength={2000}
            defaultValue={agent.mission ?? ""}
            className={textareaClass}
          />
        </Field>
        <RolesField roles={agent.roles} />
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
          Salvar o agente
        </Button>
      </div>
    </form>
  );
}

/**
 * Pausar (kill switch) ou reativar. Pausado, o agente recebe recusa em toda chamada até
 * alguém reativar; as chaves continuam valendo para quando ele voltar.
 */
export function PausarAgenteButton({
  agentId,
  name,
  status,
}: {
  agentId: string;
  name: string;
  status: "active" | "paused";
}) {
  const [state, action, pending] = useActionState(mudarStatusAgente, IDLE);
  const pausing = status === "active";
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!pausing) return;
        const ok = window.confirm(
          `Pausar ${name}? Toda chamada dele ao Hub passa a ser recusada na hora, até alguém reativar.`,
        );
        if (!ok) event.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="id" value={agentId} />
      <input
        type="hidden"
        name="status"
        value={pausing ? "paused" : "active"}
      />
      <Button
        type="submit"
        variant={pausing ? "outline" : "default"}
        size="sm"
        disabled={pending}
        aria-label={pausing ? `Pausar ${name}` : `Reativar ${name}`}
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : pausing ? (
          <Pause aria-hidden="true" />
        ) : (
          <Play aria-hidden="true" />
        )}
        {pausing ? "Pausar" : "Reativar"}
      </Button>
      {state.status === "error" ? (
        <span role="alert" className="text-xs text-danger-fg">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
