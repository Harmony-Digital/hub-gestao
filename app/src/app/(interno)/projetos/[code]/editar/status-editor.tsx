"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { ErrorNote, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE, type ActionState } from "@/lib/action-state";
import {
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABEL,
  type StatusCategory,
} from "@/modules/tasks/status-categories";
import {
  criarStatus,
  ordenarStatus,
  removerStatus,
  salvarStatus,
} from "./status-actions";
import { moveInOrder } from "./status-form";

export type StatusEditorItem = {
  id: string;
  name: string;
  color: string;
  category: StatusCategory;
  isDefault: boolean;
  tasks: number;
};

const COLOR_INPUT =
  "h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-input bg-paper p-1";

/**
 * Status das tarefas do projeto (Editar projeto): renomear, mudar a cor, tornar padrão,
 * subir e descer, remover (movendo as tarefas) e criar. A ordem é a das colunas do
 * Quadro e dos grupos da Lista.
 */
export function StatusEditor({
  projectCode,
  statuses,
}: {
  projectCode: string;
  statuses: StatusEditorItem[];
}) {
  const ids = statuses.map((s) => s.id);
  return (
    <section
      aria-labelledby="status-do-projeto"
      className="flex max-w-4xl flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="status-do-projeto"
          className="font-heading text-base font-semibold text-navy"
        >
          Status das tarefas
        </h2>
        <p className="text-sm text-ink-2">
          A ordem aqui é a das colunas do Quadro e dos grupos da Lista. A
          categoria decide o comportamento (concluir pede evidência, bloquear
          pede o motivo) e não muda depois de criada; para trocar, crie outro
          status e remova este, levando as tarefas.
        </p>
      </div>
      <ol className="flex flex-col divide-y divide-line rounded-xl border border-line">
        {statuses.map((s) => (
          <StatusRow
            key={`${s.id}:${s.name}:${s.color}:${s.isDefault}`}
            projectCode={projectCode}
            status={s}
            ids={ids}
            sameCategory={statuses.filter(
              (o) => o.category === s.category && o.id !== s.id,
            )}
          />
        ))}
      </ol>
      <NewStatusForm projectCode={projectCode} />
    </section>
  );
}

function StatusRow({
  projectCode,
  status,
  ids,
  sameCategory,
}: {
  projectCode: string;
  status: StatusEditorItem;
  ids: string[];
  sameCategory: StatusEditorItem[];
}) {
  const id = useId();
  const [state, action, pending] = useActionState(salvarStatus, IDLE);
  const submit = useSubmit(action);
  const [removing, setRemoving] = useState(false);
  const up = moveInOrder(ids, status.id, -1);
  const down = moveInOrder(ids, status.id, 1);

  return (
    <li className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={submit}
          className="flex min-w-0 flex-1 basis-72 items-center gap-2 sm:max-w-md"
          aria-label={`Editar o status ${status.name}`}
        >
          <input type="hidden" name="id" value={status.id} />
          <label className="sr-only" htmlFor={`${id}-cor`}>
            Cor de {status.name}
          </label>
          <input
            id={`${id}-cor`}
            type="color"
            name="color"
            defaultValue={status.color}
            disabled={pending}
            className={COLOR_INPUT}
          />
          <label className="sr-only" htmlFor={`${id}-nome`}>
            Nome do status
          </label>
          <input
            id={`${id}-nome`}
            name="name"
            required
            maxLength={40}
            defaultValue={status.name}
            disabled={pending}
            className={`${inputClass} min-w-0 flex-1`}
          />
          <Button
            type="submit"
            variant="outline"
            size="lg"
            disabled={pending}
            className="h-10"
          >
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            Salvar
          </Button>
        </form>
        <span className="rounded-full bg-off-2 px-2.5 py-1 text-xs text-ink-2">
          {STATUS_CATEGORY_LABEL[status.category]}
        </span>
        <span className="font-mono text-xs text-caption">
          {status.tasks} {status.tasks === 1 ? "tarefa" : "tarefas"}
        </span>
        {status.isDefault ? (
          <span className="rounded-full bg-brand/15 px-2.5 py-1 text-xs font-semibold text-brand-strong">
            Padrão das novas
          </span>
        ) : status.category === "todo" ? (
          <MakeDefault id={status.id} name={status.name} />
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Reorder
            projectCode={projectCode}
            order={up}
            label={`Subir ${status.name}`}
            icon={<ArrowUp aria-hidden="true" />}
          />
          <Reorder
            projectCode={projectCode}
            order={down}
            label={`Descer ${status.name}`}
            icon={<ArrowDown aria-hidden="true" />}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label={`Remover ${status.name}`}
            aria-expanded={removing}
            onClick={() => setRemoving((r) => !r)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
      {removing ? (
        <RemoveConfirm
          status={status}
          sameCategory={sameCategory}
          onCancel={() => setRemoving(false)}
        />
      ) : null}
    </li>
  );
}

function MakeDefault({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(salvarStatus, IDLE);
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="make_default" value="1" />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Tornar ${name} o status padrão das tarefas novas`}
      >
        Tornar padrão
      </Button>
      {state.status === "error" ? (
        <span role="alert" className="text-xs text-danger-fg">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

function Reorder({
  projectCode,
  order,
  label,
  icon,
}: {
  projectCode: string;
  order: string[] | null;
  label: string;
  icon: ReactNode;
}) {
  const [state, action, pending] = useActionState(ordenarStatus, IDLE);
  return (
    <form action={action}>
      <input type="hidden" name="project" value={projectCode} />
      <input type="hidden" name="ids" value={order?.join(",") ?? ""} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-lg"
        aria-label={label}
        title={state.status === "error" ? state.message : label}
        disabled={!order || pending}
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          icon
        )}
      </Button>
    </form>
  );
}

function RemoveConfirm({
  status,
  sameCategory,
  onCancel,
}: {
  status: StatusEditorItem;
  sameCategory: StatusEditorItem[];
  onCancel: () => void;
}) {
  const id = useId();
  const [state, action, pending] = useActionState(removerStatus, IDLE);
  const submit = useSubmit(action);
  const only = sameCategory.length === 0;
  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger-soft/40 p-3 text-sm"
    >
      <input type="hidden" name="id" value={status.id} />
      {only ? (
        <p className="text-ink">
          “{status.name}” é o único status da categoria{" "}
          {STATUS_CATEGORY_LABEL[status.category]}. Crie outro dessa categoria
          antes de remover.
        </p>
      ) : status.isDefault ? (
        <p className="text-ink">
          “{status.name}” é o padrão das tarefas novas. Torne outro status
          padrão antes de remover.
        </p>
      ) : (
        <>
          <p className="text-ink">
            Remover “{status.name}”?
            {status.tasks > 0
              ? ` As ${status.tasks} ${status.tasks === 1 ? "tarefa vai" : "tarefas vão"} para o status escolhido abaixo.`
              : " Nenhuma tarefa está nele."}
          </p>
          {status.tasks > 0 ? (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={`${id}-destino`}
                className="font-medium text-navy"
              >
                Mover as tarefas para
              </label>
              <select
                id={`${id}-destino`}
                name="move_to"
                required
                defaultValue={sameCategory[0]?.id}
                className={inputClass}
              >
                {sameCategory.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      )}
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
      <div className="flex flex-wrap gap-2">
        {!only && !status.isDefault ? (
          <Button
            type="submit"
            variant="destructive"
            size="lg"
            disabled={pending}
          >
            {pending ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : null}
            Remover o status
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={pending}
          onClick={onCancel}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function NewStatusForm({ projectCode }: { projectCode: string }) {
  const id = useId();
  const [round, setRound] = useState(0);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await criarStatus(previous, form);
      if (result.status === "ok") setRound((r) => r + 1);
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  return (
    <form
      key={round}
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-3"
      aria-label="Novo status"
    >
      <input type="hidden" name="project" value={projectCode} />
      <p className="text-sm font-semibold text-navy">Novo status</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-cor`} className="text-xs text-caption">
            Cor
          </label>
          <input
            id={`${id}-cor`}
            type="color"
            name="color"
            defaultValue="#8E93A3"
            disabled={pending}
            className={COLOR_INPUT}
          />
        </div>
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
          <label htmlFor={`${id}-nome`} className="text-xs text-caption">
            Nome
          </label>
          <input
            id={`${id}-nome`}
            name="name"
            required
            maxLength={40}
            placeholder="Ex.: Em homologação"
            disabled={pending}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-categoria`} className="text-xs text-caption">
            Categoria
          </label>
          <select
            id={`${id}-categoria`}
            name="category"
            defaultValue="todo"
            disabled={pending}
            className={`${inputClass} w-48`}
          >
            {STATUS_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {STATUS_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="lg" disabled={pending} className="h-10">
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          Criar status
        </Button>
      </div>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : state.status === "ok" && state.message ? (
          <p className="text-sm text-ok-fg">{state.message}</p>
        ) : null}
      </div>
    </form>
  );
}
