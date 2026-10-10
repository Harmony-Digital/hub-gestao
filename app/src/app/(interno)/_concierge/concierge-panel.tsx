"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useId, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CircleCheck,
  Info,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import {
  ErrorNote,
  Field,
  inputClass,
  textareaClass,
  useSubmit,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { PRIORITY } from "@/lib/labels";
import type {
  AnswerProposal,
  CommentProposal,
  CreateTaskProposal,
  UpdateTaskProposal,
} from "@/modules/concierge/proposal";
import { STATUS_CATEGORY_LABEL } from "@/modules/tasks/status-categories";
import { DecisionList } from "../_approvals/decision-list";
import { confirmarConcierge } from "./actions";
import {
  CONFIRM_IDLE,
  type ConciergeView,
  type ConfirmState,
  type InterpretState,
} from "./state";

/** O pedido feito ao Concierge: o texto, se foi falado e quando começou. */
export type ConciergeRequest = {
  id: number;
  text: string;
  voice: boolean;
  /** Início do pedido (ms), para o tempo até a confirmação. */
  started: number;
};

const PRIORITIES = ["urgent", "high", "normal", "low"] as const;

/**
 * A prévia do Concierge dentro da janela ⌘K: o que ele entendeu, para conferir, editar e
 * confirmar. Nada é gravado sem o clique em Confirmar; pedido de aprovação mostra o cartão
 * de decisão de sempre; pergunta mostra a resposta com os dados do Hub.
 */
export function ConciergePanel({
  request,
  result,
  onBack,
  onRetry,
  onClose,
}: {
  request: ConciergeRequest;
  result: InterpretState | null;
  onBack: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex max-h-[min(70vh,34rem)] flex-col gap-3 overflow-y-auto p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2
            id={titleId}
            className="font-heading text-base font-semibold text-navy"
          >
            Concierge
          </h2>
          <p className="text-xs break-words text-ink-2">
            {request.voice ? "Você disse" : "Você pediu"}: “{request.text}”
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="shrink-0"
        >
          <ArrowLeft aria-hidden="true" />
          Voltar à busca
        </Button>
      </div>
      <div aria-live="polite" className="flex flex-col gap-3">
        {result === null ? (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            Entendendo o pedido…
          </p>
        ) : !result.ok ? (
          <div className="flex flex-col gap-3">
            <ErrorNote message={result.message} />
            <div>
              <Button type="button" variant="outline" onClick={onRetry}>
                <RotateCcw aria-hidden="true" />
                Tentar de novo
              </Button>
            </div>
          </div>
        ) : (
          <Preview
            view={result.view}
            request={request}
            onBack={onBack}
            onClose={onClose}
          />
        )}
      </div>
    </section>
  );
}

function Preview({
  view,
  request,
  onBack,
  onClose,
}: {
  view: ConciergeView;
  request: ConciergeRequest;
  onBack: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  switch (view.kind) {
    case "create_task":
      return (
        <CreateTaskForm
          view={view}
          request={request}
          onBack={onBack}
          onClose={onClose}
        />
      );
    case "update_task":
      return <UpdateTaskForm view={view} request={request} onBack={onBack} />;
    case "comment":
      return <CommentForm view={view} request={request} onBack={onBack} />;
    case "approval":
      return (
        <div className="flex flex-col gap-3">
          <Note>
            Achei este pedido. A decisão é sua: o Concierge não aprova nem
            recusa nada sozinho.
          </Note>
          <DecisionList
            items={[view.item]}
            canDecide={view.canDecide}
            emptyText="Esse pedido já foi decidido."
          />
        </div>
      );
    case "answer":
      return <Answer view={view} onClose={onClose} />;
    case "navigate":
      return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3">
          <span className="text-sm text-ink">Abrir {view.label}</span>
          <Button
            type="button"
            autoFocus
            onClick={() => {
              onClose();
              router.push(view.href);
            }}
          >
            <ArrowUpRight aria-hidden="true" />
            Abrir
          </Button>
        </div>
      );
    case "unknown":
      return <Note>{view.message}</Note>;
  }
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg bg-info-soft p-3 text-sm text-info-fg">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-lg bg-warn-soft p-3 text-sm text-warn-fg">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

/** Campos escondidos comuns: tipo, métricas (editou, voz, início). */
function Meta({
  kind,
  edited,
  request,
}: {
  kind: string;
  edited: boolean;
  request: ConciergeRequest;
}) {
  return (
    <>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="edited" value={edited ? "1" : "0"} />
      <input type="hidden" name="voice" value={request.voice ? "1" : "0"} />
      <input type="hidden" name="started" value={String(request.started)} />
    </>
  );
}

function Done({
  state,
  onBack,
}: {
  state: Extract<ConfirmState, { status: "done" }>;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 rounded-xl bg-ok-soft p-3 text-sm text-ok-fg">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{state.message}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={state.href} prefetch={false}>
            <ArrowUpRight aria-hidden="true" />
            Abrir {state.code}
          </Link>
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Novo pedido
        </Button>
      </div>
    </div>
  );
}

function ConfirmBar({
  pending,
  label,
  onBack,
}: {
  pending: boolean;
  label: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={onBack}
      >
        Cancelar
      </Button>
      <Button type="submit" disabled={pending}>
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Check aria-hidden="true" />
        )}
        {label}
      </Button>
    </div>
  );
}

function useConfirm(onCreated?: (href: string) => void) {
  const [state, action, pending] = useActionState(
    async (previous: ConfirmState, form: FormData) => {
      const result = await confirmarConcierge(previous, form);
      if (result.status === "done" && result.created) onCreated?.(result.href);
      return result;
    },
    CONFIRM_IDLE,
  );
  return { state, pending, submit: useSubmit(action) };
}

function CreateTaskForm({
  view,
  request,
  onBack,
  onClose,
}: {
  view: CreateTaskProposal;
  request: ConciergeRequest;
  onBack: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [edited, setEdited] = useState(false);
  const { state, pending, submit } = useConfirm((href) => {
    onClose();
    router.push(href);
  });
  const { draft } = view;
  return (
    <form
      onSubmit={submit}
      onChange={() => setEdited(true)}
      className="flex flex-col gap-3"
    >
      <Meta kind="create_task" edited={edited} request={request} />
      <p className="text-sm font-semibold text-navy">Criar uma tarefa</p>
      <Notes notes={view.notes} />
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        <Field id={`${id}-projeto`} label="Projeto">
          <select
            id={`${id}-projeto`}
            name="project"
            required
            defaultValue={draft.project}
            className={inputClass}
          >
            <option value="" disabled>
              Escolha o projeto
            </option>
            {view.projects.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-titulo`} label="Título">
          <input
            id={`${id}-titulo`}
            name="title"
            required
            maxLength={300}
            defaultValue={draft.title}
            className={inputClass}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id={`${id}-prazo`} label="Prazo">
            <input
              id={`${id}-prazo`}
              type="date"
              name="due_date"
              defaultValue={draft.due_date}
              className={inputClass}
            />
          </Field>
          <Field id={`${id}-prioridade`} label="Prioridade">
            <select
              id={`${id}-prioridade`}
              name="priority"
              defaultValue={draft.priority}
              className={inputClass}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY[p].label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-responsavel`} label="Responsável">
            <select
              id={`${id}-responsavel`}
              name="assignee"
              defaultValue={draft.assignee}
              className={inputClass}
            >
              {view.team.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {draft.description ? (
          <Field id={`${id}-descricao`} label="Descrição">
            <textarea
              id={`${id}-descricao`}
              name="description"
              rows={3}
              defaultValue={draft.description}
              className={textareaClass}
            />
          </Field>
        ) : null}
      </fieldset>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
      <ConfirmBar pending={pending} label="Confirmar e criar" onBack={onBack} />
    </form>
  );
}

function TaskHeader({ task }: { task: UpdateTaskProposal["task"] }) {
  return (
    <p className="text-sm text-ink">
      <span className="font-mono text-xs text-ink-2">{task.code}</span>{" "}
      <span className="font-semibold text-navy">{task.title}</span>{" "}
      <span className="text-ink-2">
        ({task.project_code} · {task.status_name})
      </span>
    </p>
  );
}

function UpdateTaskForm({
  view,
  request,
  onBack,
}: {
  view: UpdateTaskProposal;
  request: ConciergeRequest;
  onBack: () => void;
}) {
  const id = useId();
  const [edited, setEdited] = useState(false);
  const [statusId, setStatusId] = useState(view.changes.status_id ?? "");
  const { state, pending, submit } = useConfirm();
  if (state.status === "done") return <Done state={state} onBack={onBack} />;
  const { changes } = view;
  const category = view.statuses.find((s) => s.id === statusId)?.category;
  return (
    <form
      onSubmit={submit}
      onChange={() => setEdited(true)}
      className="flex flex-col gap-3"
    >
      <Meta kind="update_task" edited={edited} request={request} />
      <input type="hidden" name="task" value={view.task.code} />
      <input type="hidden" name="version" value={String(view.task.version)} />
      <p className="text-sm font-semibold text-navy">Mudar a tarefa</p>
      <TaskHeader task={view.task} />
      <Notes notes={view.notes} />
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        {changes.status_id !== null ? (
          <Field id={`${id}-status`} label="Status">
            <select
              id={`${id}-status`}
              name="status_id"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
              className={inputClass}
            >
              {view.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name === STATUS_CATEGORY_LABEL[s.category]
                    ? s.name
                    : `${s.name} (${STATUS_CATEGORY_LABEL[s.category]})`}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {category === "done" ? (
          <Field
            id={`${id}-evidencia`}
            label="Evidência"
            hint="Link, commit, arquivo ou teste que comprova a entrega."
          >
            <textarea
              id={`${id}-evidencia`}
              name="evidence"
              required
              rows={2}
              defaultValue={view.reason}
              className={textareaClass}
            />
          </Field>
        ) : category === "blocked" ? (
          <Field
            id={`${id}-motivo`}
            label="Motivo do bloqueio"
            hint="O que falta e de quem depende."
          >
            <textarea
              id={`${id}-motivo`}
              name="reason"
              required
              rows={2}
              defaultValue={view.reason}
              className={textareaClass}
            />
          </Field>
        ) : null}
        {changes.title !== null ? (
          <Field id={`${id}-titulo`} label="Título novo">
            <input
              id={`${id}-titulo`}
              name="title"
              required
              maxLength={300}
              defaultValue={changes.title}
              className={inputClass}
            />
          </Field>
        ) : null}
        {changes.due_date !== null ? (
          <Field id={`${id}-prazo`} label="Prazo novo">
            <input
              id={`${id}-prazo`}
              type="date"
              name="due_date"
              required
              defaultValue={changes.due_date}
              className={inputClass}
            />
          </Field>
        ) : null}
        {changes.priority !== null ? (
          <Field id={`${id}-prioridade`} label="Prioridade nova">
            <select
              id={`${id}-prioridade`}
              name="priority"
              defaultValue={changes.priority}
              className={inputClass}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY[p].label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {changes.assignee !== null ? (
          <Field id={`${id}-responsavel`} label="Responsável novo">
            <select
              id={`${id}-responsavel`}
              name="assignee"
              required
              defaultValue={changes.assignee}
              className={inputClass}
            >
              {view.team
                .filter((m) => m.value !== "")
                .map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
            </select>
          </Field>
        ) : null}
      </fieldset>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
      <ConfirmBar pending={pending} label="Confirmar" onBack={onBack} />
    </form>
  );
}

function CommentForm({
  view,
  request,
  onBack,
}: {
  view: CommentProposal;
  request: ConciergeRequest;
  onBack: () => void;
}) {
  const id = useId();
  const [edited, setEdited] = useState(false);
  const { state, pending, submit } = useConfirm();
  if (state.status === "done") return <Done state={state} onBack={onBack} />;
  return (
    <form
      onSubmit={submit}
      onChange={() => setEdited(true)}
      className="flex flex-col gap-3"
    >
      <Meta kind="comment" edited={edited} request={request} />
      <input type="hidden" name="task" value={view.task.code} />
      <p className="text-sm font-semibold text-navy">Comentar na tarefa</p>
      <TaskHeader task={view.task} />
      <Notes notes={view.notes} />
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        <Field id={`${id}-comentario`} label="Comentário">
          <textarea
            id={`${id}-comentario`}
            name="body"
            required
            rows={4}
            maxLength={10000}
            defaultValue={view.body}
            className={textareaClass}
          />
        </Field>
      </fieldset>
      {state.status === "error" ? <ErrorNote message={state.message} /> : null}
      <ConfirmBar
        pending={pending}
        label="Publicar comentário"
        onBack={onBack}
      />
    </form>
  );
}

function Answer({
  view,
  onClose,
}: {
  view: AnswerProposal;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-navy">{view.title}</p>
      {view.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-3 text-sm text-ink-2">
          {view.empty}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
          {view.items.map((item) => (
            <li key={`${item.href}|${item.label}`}>
              <Link
                href={item.href}
                prefetch={false}
                onClick={onClose}
                className="flex flex-col gap-0.5 px-3 py-2 text-sm hover:bg-off"
              >
                <span className="break-words text-ink">{item.label}</span>
                {item.hint ? (
                  <span className="text-xs break-words text-ink-2">
                    {item.hint}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {view.more ? (
        <Link
          href={view.more.href}
          prefetch={false}
          onClick={onClose}
          className="inline-flex items-center gap-1 self-start text-sm font-semibold text-brand-strong hover:text-navy"
        >
          {view.more.label}
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
      <p className="text-xs text-caption">
        Resposta com os dados do Hub, no seu alcance.
      </p>
    </div>
  );
}
