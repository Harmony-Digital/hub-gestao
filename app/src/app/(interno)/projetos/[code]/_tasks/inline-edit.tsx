"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useTransition,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { CircleAlert, LoaderCircle } from "lucide-react";
import type { AssigneeOption, StatusOption } from "@/modules/tasks/board";
import { editarCampoNaLista } from "./actions";

const CONTROL =
  "h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 text-xs text-ink-2 hover:border-line focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:outline-none disabled:opacity-60";

type Base = { code: string; version: number };

type Field = HTMLSelectElement | HTMLInputElement;

/**
 * As opções das células (status e responsáveis), uma vez para a Lista inteira: passar a
 * lista em cada linha repetia tudo no pacote da página (com 5 mil tarefas, megabytes).
 */
const ListOptions = createContext<{
  statuses: StatusOption[];
  assignees: AssigneeOption[];
}>({ statuses: [], assignees: [] });

export function ListOptionsProvider({
  statuses,
  assignees,
  children,
}: {
  statuses: StatusOption[];
  assignees: AssigneeOption[];
  children: ReactNode;
}) {
  return (
    <ListOptions.Provider value={{ statuses, assignees }}>
      {children}
    </ListOptions.Provider>
  );
}

/**
 * Uma célula editável: muda e grava na hora, chamando a ação direto (sem formulário nem
 * campos escondidos por linha); erro fica no ícone ao lado.
 */
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
    save: (event: ChangeEvent<Field>) => void,
    pending: boolean,
  ) => ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // O contêiner fica em estado, não em ref, como no FormDialog: o efeito abaixo o usa e
  // a regra do React não deixa ler ref durante a renderização.
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  // Mudança feita por outra pessoa ou agente (a tela se atualiza sozinha): o campo passa
  // a mostrar o valor novo, a menos que esteja em uso agora.
  useEffect(() => {
    const input = box?.querySelector<Field>("select, input");
    if (input && document.activeElement !== input) input.value = value;
  }, [box, value]);
  const save = (event: ChangeEvent<Field>) => {
    const next = event.currentTarget.value;
    setError(null);
    startTransition(async () => {
      const result = await editarCampoNaLista({
        code,
        version,
        field,
        value: next,
      });
      if (result.status === "error") setError(result.message);
    });
  };
  return (
    <div
      ref={setBox}
      role="group"
      aria-label={label}
      className="flex min-w-0 items-center gap-1"
    >
      {children(save, pending)}
      {pending ? (
        <LoaderCircle
          aria-hidden="true"
          className="size-3.5 shrink-0 animate-spin text-caption"
        />
      ) : error ? (
        <span role="alert" title={error} className="shrink-0">
          <CircleAlert aria-hidden="true" className="size-3.5 text-danger-fg" />
          <span className="sr-only">{error}</span>
        </span>
      ) : null}
    </div>
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
      {(save, pending) => (
        <select
          defaultValue={priority}
          disabled={pending}
          onChange={save}
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
  ...base
}: Base & { assignee: string }) {
  const { assignees } = useContext(ListOptions);
  const known = assignees.some((a) => `${a.type}:${a.id}` === assignee);
  return (
    <Cell
      {...base}
      field="assignee"
      label={`Responsável por ${base.code}`}
      value={assignee}
    >
      {(save, pending) => (
        <select
          defaultValue={assignee}
          disabled={pending}
          onChange={save}
          aria-label={`Responsável por ${base.code}`}
          className={CONTROL}
        >
          <option value="">Ninguém</option>
          {assignee && !known ? (
            <option value={assignee}>Responsável atual</option>
          ) : null}
          {assignees.map((a) => (
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
      {(save, pending) => (
        <input
          type="date"
          defaultValue={due ?? ""}
          disabled={pending}
          onChange={save}
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
  panelHref,
  ...base
}: Base & { statusId: string; panelHref: string }) {
  const router = useRouter();
  const { statuses } = useContext(ListOptions);
  return (
    <Cell
      {...base}
      field="status"
      label={`Status de ${base.code}`}
      value={statusId}
    >
      {(save, pending) => (
        <select
          defaultValue={statusId}
          disabled={pending}
          onChange={(event) => {
            const target = statuses.find((s) => s.id === event.target.value);
            if (target?.category === "done" || target?.category === "blocked") {
              event.target.value = statusId;
              router.push(panelHref, { scroll: false });
              return;
            }
            save(event);
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
