"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRIORITY } from "@/lib/labels";
import type { AssigneeOption, WorkstreamOption } from "@/modules/tasks/board";
import { criarTarefa } from "./actions";
import { IDLE, PRIORITIES, type CreateTaskState } from "./form";
import { ErrorNote, inputClass, textareaClass, useSubmit } from "./task-forms";

type Props = {
  projectCode: string;
  /** Tela onde o painel da tarefa nova vai abrir (lista ou visão geral). */
  basePath: string;
  /** Frente filtrada na lista: já vem escolhida na tarefa nova. */
  workstream: string | null;
  workstreams: WorkstreamOption[];
  assignees: AssigneeOption[];
};

/** Botão "Nova tarefa": abre o formulário numa janela e, ao criar, abre a tarefa. */
export function NewTaskButton(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Cada abertura começa um formulário limpo, sem o erro da vez anterior.
  const [round, setRound] = useState(0);

  return (
    <>
      <Button
        type="button"
        size="lg"
        onClick={() => {
          setRound((r) => r + 1);
          dialog.current?.showModal();
        }}
      >
        <Plus aria-hidden="true" />
        Nova tarefa
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="nova-tarefa-titulo"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
        className="m-auto w-[min(92vw,34rem)] max-w-none rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-navy-3/50"
      >
        <NewTaskForm
          key={round}
          {...props}
          onClose={() => dialog.current?.close()}
        />
      </dialog>
    </>
  );
}

function NewTaskForm({
  projectCode,
  basePath,
  workstream,
  workstreams,
  assignees,
  onClose,
}: Props & { onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    async (previous: CreateTaskState, form: FormData) => {
      const result = await criarTarefa(previous, form);
      if (result.status === "created") {
        onClose();
        const params = new URLSearchParams();
        if (workstream) params.set("frente", workstream);
        params.set("tarefa", result.code);
        router.push(`${basePath}?${params}`, { scroll: false });
      }
      return result;
    },
    IDLE as CreateTaskState,
  );
  const submit = useSubmit(action);
  const people = assignees.filter((a) => a.type === "user");
  const agents = assignees.filter((a) => a.type === "agent");

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-5 sm:p-6">
      <input type="hidden" name="project" value={projectCode} />
      <h2
        id="nova-tarefa-titulo"
        className="font-heading text-lg font-semibold text-navy"
      >
        Nova tarefa em {projectCode}
      </h2>

      <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
        Título
        <input
          name="title"
          required
          maxLength={300}
          autoFocus
          disabled={pending}
          placeholder="O que precisa ser feito"
          className={inputClass}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
          Frente
          <select
            name="workstream_id"
            defaultValue={workstream && workstream !== "none" ? workstream : ""}
            disabled={pending}
            className={inputClass}
          >
            <option value="">Sem frente</option>
            {workstreams.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
          Responsável
          <select
            name="assignee"
            defaultValue=""
            disabled={pending}
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
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
          Prioridade
          <select
            name="priority"
            defaultValue="normal"
            disabled={pending}
            className={inputClass}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY[p].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
          Prazo
          <input
            type="date"
            name="due_date"
            disabled={pending}
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm font-medium text-navy">
        Descrição
        <textarea
          name="description_md"
          rows={4}
          maxLength={20000}
          disabled={pending}
          placeholder="Contexto, critérios de pronto e links úteis (opcional)."
          className={textareaClass}
        />
      </label>

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
          onClick={onClose}
        >
          Cancelar
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          Criar tarefa
        </Button>
      </div>
    </form>
  );
}
