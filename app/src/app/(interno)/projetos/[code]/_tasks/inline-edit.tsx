"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import type { AssigneeOption, StatusOption } from "@/modules/tasks/board";
import { editarNaLista } from "./actions";
import { IDLE } from "./form";

const CONTROL =
  "h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-xs text-ink-2 hover:border-line focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:outline-none disabled:opacity-60";

type Base = { code: string; version: number };

type Field = HTMLSelectElement | HTMLInputElement;

/** Mudou o campo, envia o formulário dele (sem ref: o próprio campo acha o form). */
const submitForm = (event: ChangeEvent<Field>) =>
  event.currentTarget.form?.requestSubmit();

/** Uma célula editável: muda e grava na hora; erro fica no ícone ao lado. */
function Cell({
  code,
  version,
  field,
  label,
  value,
  children,
}: Base & {
  field: string;
  label: string;
  /** Valor gravado; o campo começa com ele e o acompanha quando muda por fora. */
  value: string;
  children: (
    submit: (event: ChangeEvent<Field>) => void,
    pending: boolean,
  ) => React.ReactNode;
}) {
  const [state, action, pending] = useActionState(editarNaLista, IDLE);
  // O formulário fica em estado, não em ref, como no FormDialog: o efeito abaixo o usa
  // e a regra do React não deixa ler ref durante a renderização.
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  // Mudança feita por outra pessoa ou agente (a tela se atualiza sozinha): o campo passa
  // a mostrar o valor novo, a menos que esteja em uso agora.
  useEffect(() => {
    const input = form?.elements.namedItem("value");
    if (!(
      input instanceof HTMLSelectElement || input instanceof HTMLInputElement
    )) {
      return;
    }
    if (document.activeElement !== input) input.value = value;
  }, [form, value]);
  return (
    <form
      ref={setForm}
      action={action}
      className="flex min-w-0 items-center gap-1"
      aria-label={label}
    >
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="field" value={field} />
      {children(submitForm, pending)}
      {pending ? (
        <LoaderCircle
          aria-hidden="true"
          className="size-3.5 shrink-0 animate-spin text-caption"
        />
      ) : state.status === "error" ? (
        <span role="alert" title={state.message} className="shrink-0">
          <CircleAlert aria-hidden="true" className="size-3.5 text-danger-fg" />
          <span className="sr-only">{state.message}</span>
        </span>
      ) : null}
    </form>
  );
}

export function PriorityCell({
  priority,
  ...base
}: Base & { priority: string }) {
  return (
    <Cell
      {...base}
      field="priority"
      label={`Prioridade de ${base.code}`}
      value={priority}
    >
      {(submit, pending) => (
        <select
          name="value"
          defaultValue={priority}
          disabled={pending}
          onChange={submit}
          aria-label={`Prioridade de ${base.code}`}
          className={CONTROL}
        >
          <option value="urgent">Urgente</option>
          <option value="high">Alta</option>
          <option value="normal">Normal</option>
          <option value="low">Baixa</option>
        </select>
      )}
    </Cell>
  );
}

export function AssigneeCell({
  assignee,
  options,
  ...base
}: Base & { assignee: string; options: AssigneeOption[] }) {
  const known = options.some((a) => `${a.type}:${a.id}` === assignee);
  return (
    <Cell
      {...base}
      field="assignee"
      label={`Responsável por ${base.code}`}
      value={assignee}
    >
      {(submit, pending) => (
        <select
          name="value"
          defaultValue={assignee}
          disabled={pending}
          onChange={submit}
          aria-label={`Responsável por ${base.code}`}
          className={CONTROL}
        >
          <option value="">Ninguém</option>
          {assignee && !known ? (
            <option value={assignee}>Responsável atual</option>
          ) : null}
          {options.map((a) => (
            <option key={`${a.type}:${a.id}`} value={`${a.type}:${a.id}`}>
              {a.name}
              {a.type === "agent" ? " (agente)" : ""}
            </option>
          ))}
        </select>
      )}
    </Cell>
  );
}

export function DueCell({
  due,
  late,
  ...base
}: Base & { due: string | null; late: boolean }) {
  return (
    <Cell
      {...base}
      field="due_date"
      label={`Prazo de ${base.code}`}
      value={due ?? ""}
    >
      {(submit, pending) => (
        <input
          type="date"
          name="value"
          defaultValue={due ?? ""}
          disabled={pending}
          onChange={submit}
          aria-label={`Prazo de ${base.code}${late ? " (atrasada)" : ""}`}
          className={`${CONTROL} ${late ? "font-semibold text-danger-fg" : ""}`}
        />
      )}
    </Cell>
  );
}

/**
 * Status na linha. Concluir pede evidência e bloquear pede o motivo: nesses casos a
 * escolha abre o painel da tarefa, onde o pedido é feito.
 */
export function StatusCell({
  statusId,
  statuses,
  panelHref,
  ...base
}: Base & { statusId: string; statuses: StatusOption[]; panelHref: string }) {
  const router = useRouter();
  return (
    <Cell
      {...base}
      field="status"
      label={`Status de ${base.code}`}
      value={statusId}
    >
      {(submit, pending) => (
        <select
          name="value"
          defaultValue={statusId}
          disabled={pending}
          onChange={(event) => {
            const target = statuses.find((s) => s.id === event.target.value);
            if (target?.category === "done" || target?.category === "blocked") {
              event.target.value = statusId;
              router.push(panelHref, { scroll: false });
              return;
            }
            submit(event);
          }}
          aria-label={`Status de ${base.code}`}
          className={CONTROL}
        >
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.category === "done" || s.category === "blocked" ? "…" : ""}
            </option>
          ))}
        </select>
      )}
    </Cell>
  );
}
