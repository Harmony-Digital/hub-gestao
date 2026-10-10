"use client";

import { useActionState, useId, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, Pencil } from "lucide-react";
import {
  ErrorNote,
  inputClass,
  textareaClass,
  useSubmit,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { PRIORITY } from "@/lib/labels";
import type {
  AssigneeOption,
  StatusOption,
  WorkstreamOption,
} from "@/modules/tasks/board";
import { mudarStatus, salvarTarefa } from "./actions";
import { IDLE, PRIORITIES, type ActionState } from "./form";

function Hidden({ code, version }: { code: string; version?: number }) {
  return (
    <>
      <input type="hidden" name="code" value={code} />
      {version !== undefined ? (
        <input type="hidden" name="version" value={version} />
      ) : null}
    </>
  );
}

// Status -----------------------------------------------------------------------------

export function StatusPicker({
  code,
  version,
  statuses,
  currentId,
}: {
  code: string;
  version: number;
  statuses: StatusOption[];
  currentId: string;
}) {
  const [target, setTarget] = useState<StatusOption | null>(null);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await mudarStatus(previous, form);
      if (result.status === "ok") setTarget(null);
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const done = target?.category === "done";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Hidden code={code} version={version} />
      <div
        role="group"
        aria-label="Status da tarefa"
        className="flex flex-wrap gap-1.5"
      >
        {statuses.map((s) => {
          const current = s.id === currentId;
          const chosen = target?.id === s.id;
          const needsNote =
            !current && (s.category === "blocked" || s.category === "done");
          return (
            <button
              key={s.id}
              type={current || needsNote ? "button" : "submit"}
              name={current || needsNote ? undefined : "status_id"}
              value={current || needsNote ? undefined : s.id}
              aria-pressed={current}
              disabled={pending}
              onClick={
                needsNote ? () => setTarget(chosen ? null : s) : undefined
              }
              className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm transition-colors disabled:opacity-60 ${
                current
                  ? "border-navy bg-navy font-semibold text-off"
                  : chosen
                    ? "border-brand bg-brand-soft/20 text-navy"
                    : "border-line bg-paper text-ink-2 hover:border-mist hover:text-navy"
              }`}
            >
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ background: s.color }}
              />
              {s.name}
            </button>
          );
        })}
        {pending ? (
          <LoaderCircle
            aria-label="Salvando"
            className="size-5 animate-spin self-center text-caption"
          />
        ) : null}
      </div>

      {target ? (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-off p-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
            {done ? "Evidência da entrega" : "O que falta e de quem depende"}
            <textarea
              key={target.id}
              name={done ? "evidence" : "reason"}
              required
              maxLength={2000}
              rows={3}
              autoFocus
              disabled={pending}
              placeholder={
                done
                  ? "Link, arquivo, commit ou o que comprova que está pronto."
                  : "Ex.: aguarda o acesso da agenda, que o cliente vai enviar."
              }
              className={textareaClass}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              name="status_id"
              value={target.id}
              size="lg"
              disabled={pending}
            >
              {done ? "Concluir a tarefa" : "Bloquear a tarefa"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={pending}
              onClick={() => setTarget(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : null}
      </div>
    </form>
  );
}

// Título e campos --------------------------------------------------------------------

/** Salva ao sair do campo ou com Enter, só quando o texto mudou. */
export function TitleField({
  code,
  version,
  title,
}: {
  code: string;
  version: number;
  title: string;
}) {
  const [state, action, pending] = useActionState(salvarTarefa, IDLE);
  const submit = useSubmit(action);
  const form = useRef<HTMLFormElement>(null);
  const saveIfChanged = (value: string) => {
    if (value.trim() && value.trim() !== title) form.current?.requestSubmit();
  };
  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-2">
      <Hidden code={code} version={version} />
      <label htmlFor="tarefa-titulo" className="sr-only">
        Título da tarefa
      </label>
      {/* Área de texto para títulos longos quebrarem a linha; Enter salva (título é
          sempre uma linha só). */}
      <textarea
        id="tarefa-titulo"
        name="title"
        defaultValue={title}
        required
        maxLength={300}
        rows={1}
        disabled={pending}
        onBlur={(e) => saveIfChanged(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            saveIfChanged(e.currentTarget.value);
          }
        }}
        className="field-sizing-content w-full resize-none rounded-lg border border-transparent bg-transparent px-1 py-1 font-heading text-xl leading-snug font-semibold text-navy outline-none hover:border-line focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/30 disabled:opacity-60"
      />
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : null}
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-caption">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Responsável, prioridade e frente salvam ao escolher; o prazo, ao sair do campo (assim
 * digitar a data aos poucos não grava datas pela metade). Remonta a cada versão salva.
 */
export function TaskFieldsForm({
  code,
  version,
  assignee,
  dueDate,
  late,
  priority,
  workstreamId,
  assignees,
  workstreams,
}: {
  code: string;
  version: number;
  assignee: string;
  dueDate: string | null;
  late: boolean;
  priority: string;
  workstreamId: string | null;
  assignees: AssigneeOption[];
  workstreams: WorkstreamOption[];
}) {
  const [state, action, pending] = useActionState(salvarTarefa, IDLE);
  const submit = useSubmit(action);
  const form = useRef<HTMLFormElement>(null);
  const ids = useId();
  const save = () => form.current?.requestSubmit();
  const people = assignees.filter((a) => a.type === "user");
  const agents = assignees.filter((a) => a.type === "agent");

  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-3">
      <Hidden code={code} version={version} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${ids}-responsavel`} label="Responsável">
          <select
            id={`${ids}-responsavel`}
            name="assignee"
            defaultValue={assignee}
            disabled={pending}
            onChange={save}
            className={inputClass}
          >
            <option value="">Ninguém</option>
            {people.length > 0 ? (
              <optgroup label="Pessoas">
                {people.map((p) => (
                  <option key={p.id} value={`user:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {agents.length > 0 ? (
              <optgroup label="Agentes">
                {agents.map((a) => (
                  <option key={a.id} value={`agent:${a.id}`}>
                    {a.name}
                    {a.paused ? " (pausado)" : ""}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </Field>
        <Field
          id={`${ids}-prazo`}
          label={
            <span className="flex items-center gap-2">
              Prazo
              {late ? (
                <span className="rounded-full bg-danger-soft px-2 py-px text-[11px] font-semibold text-danger-fg">
                  Atrasada
                </span>
              ) : null}
            </span>
          }
        >
          <input
            id={`${ids}-prazo`}
            type="date"
            name="due_date"
            defaultValue={dueDate ?? ""}
            disabled={pending}
            onBlur={(e) => {
              // Data digitada pela metade fica de fora (badInput): não apaga o prazo.
              const input = e.currentTarget;
              if (!input.validity.badInput && input.value !== (dueDate ?? "")) {
                save();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            className={inputClass}
          />
        </Field>
        <Field id={`${ids}-prioridade`} label="Prioridade">
          <select
            id={`${ids}-prioridade`}
            name="priority"
            defaultValue={priority}
            disabled={pending}
            onChange={save}
            className={inputClass}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY[p].label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${ids}-frente`} label="Frente">
          <select
            id={`${ids}-frente`}
            name="workstream_id"
            defaultValue={workstreamId ?? ""}
            disabled={pending}
            onChange={save}
            className={inputClass}
          >
            <option value="">Sem frente</option>
            {workstreams.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : null}
      </div>
    </form>
  );
}

// Descrição --------------------------------------------------------------------------

export function DescriptionField({
  code,
  version,
  description,
  children,
}: {
  code: string;
  version: number;
  description: string | null;
  /** A descrição já formatada (links clicáveis), feita no servidor. */
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await salvarTarefa(previous, form);
      if (result.status === "ok") setEditing(false);
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);

  if (!editing) {
    return (
      <div className="flex flex-col items-start gap-2">
        {description ? (
          <div className="text-sm leading-relaxed break-words whitespace-pre-wrap text-ink">
            {children}
          </div>
        ) : (
          <p className="text-sm text-caption">Sem descrição.</p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(true)}
        >
          <Pencil aria-hidden="true" />
          {description ? "Editar a descrição" : "Escrever a descrição"}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Hidden code={code} version={version} />
      <label htmlFor="tarefa-descricao" className="sr-only">
        Descrição da tarefa
      </label>
      <textarea
        id="tarefa-descricao"
        name="description_md"
        defaultValue={description ?? ""}
        rows={8}
        maxLength={20000}
        autoFocus
        disabled={pending}
        className={textareaClass}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : null}
          Salvar a descrição
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={pending}
          onClick={() => setEditing(false)}
        >
          Cancelar
        </Button>
      </div>
      <div aria-live="polite">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : null}
      </div>
    </form>
  );
}
