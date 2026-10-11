"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import {
  Archive,
  Eye,
  LoaderCircle,
  Pencil,
  Plus,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
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
import { WORKSTREAM_STATUS } from "@/lib/labels";
import type { AssigneeOption } from "@/modules/tasks/board";
import { ArchiveConfirm } from "../../../_archive/archive-controls";
import {
  checkClientText,
  describeIssue,
  type ClientTextContext,
  type ClientTextIssue,
} from "@/modules/client-text/check";
import { salvarFrente, sugerirTextoCliente } from "./actions";
import { WORKSTREAM_STATUSES } from "./form";

/** A frente como o formulário de edição precisa. */
export type WorkstreamInitial = {
  id: string;
  title: string;
  milestone: string | null;
  department: string | null;
  status: (typeof WORKSTREAM_STATUSES)[number];
  description_internal: string | null;
  /** "user:<id>" ou "agent:<id>". */
  assignee: string | null;
  assigneeName: string | null;
  visibility: "internal" | "client";
  title_client: string | null;
  description_client: string | null;
  /** Frentes de que esta depende (ids). */
  dependsOn: string[];
  /** Tarefas da frente: com alguma, o status sai delas (RF-12). */
  taskCount: number;
};

export type WorkstreamFormOptions = {
  milestones: { code: string; title: string }[];
  departments: { slug: string; name: string }[];
  assignees: AssigneeOption[];
  /** Frentes ativas do projeto, para a lista "Depende de". */
  workstreams: { id: string; title: string; milestone: string | null }[];
  /** Quem pode mostrar a frente ao cliente (workstream.visibility). */
  canShowClient: boolean;
  /**
   * Verificação do texto para o cliente (RC-12, regra em código, roda na tela) e o
   * Redator: null quando pronto, ou o motivo de não estar ligado.
   */
  clientText?: { context: ClientTextContext; writer: string | null } | null;
};

/** "Nova frente" (sem frente) ou "Editar" (com a frente), numa janela. */
export function WorkstreamButton({
  projectCode,
  workstream,
  options,
}: {
  projectCode: string;
  workstream?: WorkstreamInitial;
  options: WorkstreamFormOptions;
}) {
  return (
    <FormDialog
      label={workstream ? "Editar" : "Nova frente"}
      accessibleLabel={
        workstream ? `Editar a frente ${workstream.title}` : undefined
      }
      icon={
        workstream ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />
      }
      variant={workstream ? "ghost" : "outline"}
      size={workstream ? "sm" : "lg"}
      title={workstream ? "Editar frente" : `Nova frente em ${projectCode}`}
      description={
        workstream
          ? workstream.title
          : "Uma linha de trabalho de um departamento, ligada a um marco."
      }
      wide
    >
      {(close) => (
        <WorkstreamForm
          projectCode={projectCode}
          workstream={workstream}
          options={options}
          onDone={close}
        />
      )}
    </FormDialog>
  );
}

function WorkstreamForm({
  projectCode,
  workstream,
  options,
  onDone,
}: {
  projectCode: string;
  workstream?: WorkstreamInitial;
  options: WorkstreamFormOptions;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      const result = await salvarFrente(previous, form);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);
  const id = useId();
  const people = options.assignees.filter((a) => a.type === "user");
  const agents = options.assignees.filter((a) => a.type === "agent");
  // Responsável que saiu da lista (pessoa desativada, agente revogado): continua
  // escolhido, para salvar outra mudança não apagar o responsável sem querer.
  const current = workstream?.assignee ?? null;
  const missing =
    current !== null &&
    !options.assignees.some((a) => `${a.type}:${a.id}` === current);
  // Arquivar troca o formulário pela confirmação, na mesma janela.
  const [archiving, setArchiving] = useState(false);
  const others = options.workstreams.filter((w) => w.id !== workstream?.id);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <>
      {workstream && archiving ? (
        <ArchiveConfirm
          target={{ entity: "workstream", ref: workstream.id }}
          question={`Arquivar a frente “${workstream.title}”?`}
          consequence="A frente sai da Visão geral, dos filtros e do portal do cliente. As tarefas concluídas continuam no histórico. Dá para restaurar em “Frentes arquivadas”, no fim da camada tática."
          confirmLabel="Arquivar a frente"
          onCancel={() => setArchiving(false)}
          onDone={onDone}
        />
      ) : null}
      <form
        ref={formRef}
        onSubmit={submit}
        className={archiving ? "hidden" : "flex flex-col gap-4"}
      >
        <input type="hidden" name="project" value={projectCode} />
        {workstream ? (
          <input type="hidden" name="id" value={workstream.id} />
        ) : null}
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
          <Field id={`${id}-title`} label="Título da frente">
            <input
              id={`${id}-title`}
              name="title"
              required
              maxLength={200}
              autoFocus
              defaultValue={workstream?.title ?? ""}
              placeholder="Ex.: Integração com a agenda"
              className={inputClass}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${id}-department`} label="Departamento">
              <select
                id={`${id}-department`}
                name="department"
                defaultValue={workstream?.department ?? ""}
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
            <Field id={`${id}-milestone`} label="Marco">
              <select
                id={`${id}-milestone`}
                name="milestone"
                defaultValue={workstream?.milestone ?? ""}
                className={inputClass}
              >
                <option value="">Sem marco</option>
                {options.milestones.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code} · {m.title}
                  </option>
                ))}
              </select>
            </Field>
            {workstream && workstream.taskCount > 0 ? (
              <Field
                id={`${id}-status`}
                label="Status"
                hint="Sai das tarefas da frente: muda quando elas mudam."
              >
                <input type="hidden" name="status" value={workstream.status} />
                <output
                  id={`${id}-status`}
                  className={`${inputClass} flex items-center bg-off`}
                >
                  {WORKSTREAM_STATUS[workstream.status].label}
                </output>
              </Field>
            ) : (
              <Field id={`${id}-status`} label="Status">
                <select
                  id={`${id}-status`}
                  name="status"
                  defaultValue={workstream?.status ?? "planned"}
                  className={inputClass}
                >
                  {WORKSTREAM_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {WORKSTREAM_STATUS[s].label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field id={`${id}-assignee`} label="Responsável">
              <select
                id={`${id}-assignee`}
                name="assignee"
                defaultValue={workstream?.assignee ?? ""}
                className={inputClass}
              >
                <option value="">Ninguém</option>
                {missing ? (
                  <option value={current}>
                    {workstream?.assigneeName ?? "Responsável atual"} (atual)
                  </option>
                ) : null}
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
          </div>

          <Field
            id={`${id}-description`}
            label="Descrição interna (opcional)"
            hint="Só a equipe e os agentes veem."
          >
            <textarea
              id={`${id}-description`}
              name="description_internal"
              rows={3}
              maxLength={4000}
              defaultValue={workstream?.description_internal ?? ""}
              className={textareaClass}
            />
          </Field>

          {others.length > 0 ? (
            <fieldset className="flex min-w-0 flex-col gap-2">
              <input type="hidden" name="dependencies_section" value="1" />
              <legend className="text-sm font-medium text-ink">
                Depende de (opcional)
              </legend>
              <p id={`${id}-depends-hint`} className="text-xs text-caption">
                Esta frente só deveria começar quando as marcadas terminarem. A
                Visão geral avisa se ela começar antes.
              </p>
              <div
                aria-describedby={`${id}-depends-hint`}
                className="flex max-h-44 flex-col gap-1.5 overflow-y-auto rounded-xl border border-line p-3"
              >
                {others.map((w) => (
                  <label
                    key={w.id}
                    className="flex items-start gap-2 text-sm text-ink"
                  >
                    <input
                      type="checkbox"
                      name="depends_on"
                      value={w.id}
                      defaultChecked={workstream?.dependsOn.includes(w.id)}
                      className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
                    />
                    <span>
                      {w.title}
                      {w.milestone ? (
                        <span className="text-ink-2"> · {w.milestone}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {options.canShowClient ? (
            <ClientSection
              id={id}
              projectCode={projectCode}
              workstream={workstream}
              clientText={options.clientText ?? null}
              internal={() => ({
                title:
                  (
                    formRef.current?.elements.namedItem(
                      "title",
                    ) as HTMLInputElement | null
                  )?.value ?? "",
                description:
                  (
                    formRef.current?.elements.namedItem(
                      "description_internal",
                    ) as HTMLTextAreaElement | null
                  )?.value ?? "",
              })}
            />
          ) : (
            <p className="rounded-xl bg-off p-4 text-sm text-ink-2">
              {workstream?.visibility === "client"
                ? "Esta frente aparece para o cliente."
                : "Esta frente é só da equipe."}{" "}
              Mostrar ou esconder do cliente é decisão do dono ou de um
              administrador.
            </p>
          )}
        </fieldset>

        <div aria-live="polite">
          {state.status === "error" ? (
            <ErrorNote message={state.message} />
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {workstream ? (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={pending}
              className="mr-auto text-danger-fg"
              onClick={() => setArchiving(true)}
            >
              <Archive aria-hidden="true" />
              Arquivar
            </Button>
          ) : null}
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
            {workstream ? "Salvar a frente" : "Criar frente"}
          </Button>
        </div>
      </form>
    </>
  );
}

/** Alertas sem repetição (o mesmo termo no título e na descrição aparece uma vez). */
function uniqueIssues(issues: ClientTextIssue[]): ClientTextIssue[] {
  const seen = new Map<string, ClientTextIssue>();
  for (const issue of issues) {
    seen.set(`${issue.kind}:${issue.term.toLowerCase()}`, issue);
  }
  return [...seen.values()];
}

type Suggestion = {
  title: string;
  description: string | null;
  notes: string | null;
  issues: ClientTextIssue[];
};

/**
 * "O que o cliente vê": mostrar ao cliente, o título e a descrição para ele, os alertas
 * da verificação em código (enquanto a pessoa escreve) e a sugestão do Redator do
 * Cliente (RC-12), que a pessoa usa ou descarta. Nada vai para o portal sem salvar.
 */
function ClientSection({
  id,
  projectCode,
  workstream,
  clientText,
  internal,
}: {
  id: string;
  projectCode: string;
  workstream?: WorkstreamInitial;
  clientText: { context: ClientTextContext; writer: string | null } | null;
  internal: () => { title: string; description: string };
}) {
  const [title, setTitle] = useState(workstream?.title_client ?? "");
  const [description, setDescription] = useState(
    workstream?.description_client ?? "",
  );
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, startAsking] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const issues = clientText
    ? uniqueIssues([
        ...checkClientText(title, clientText.context),
        ...checkClientText(description, clientText.context),
      ])
    : [];

  const ask = () => {
    const source = internal();
    setError(null);
    startAsking(async () => {
      const result = await sugerirTextoCliente({
        project: projectCode,
        title: title.trim() || source.title,
        description: description.trim() || source.description.trim() || null,
      });
      if (result.ok) {
        setSuggestion({
          title: result.title,
          description: result.description,
          notes: result.notes,
          issues: result.issues,
        });
      } else {
        setSuggestion(null);
        setError(result.message);
      }
    });
  };

  const use = (s: Suggestion) => {
    if (titleRef.current) titleRef.current.value = s.title;
    if (descriptionRef.current) {
      descriptionRef.current.value = s.description ?? "";
    }
    setTitle(s.title);
    setDescription(s.description ?? "");
    setSuggestion(null);
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-off p-4">
      <input type="hidden" name="visibility_section" value="1" />
      <p className="flex items-center gap-2 text-sm font-semibold text-navy">
        <Eye aria-hidden="true" className="size-4" />O que o cliente vê
      </p>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="client_visible"
          defaultChecked={workstream?.visibility === "client"}
          className="mt-0.5 size-4 accent-[var(--color-brand)]"
        />
        Mostrar esta frente ao cliente no portal. As tarefas continuam só da
        equipe.
      </label>
      <Field
        id={`${id}-title-client`}
        label="Título para o cliente"
        hint="Obrigatório para mostrar. O portal nunca usa o título interno."
      >
        <input
          ref={titleRef}
          id={`${id}-title-client`}
          name="title_client"
          maxLength={200}
          defaultValue={workstream?.title_client ?? ""}
          onInput={(e) => setTitle(e.currentTarget.value)}
          className={inputClass}
        />
      </Field>
      <Field
        id={`${id}-description-client`}
        label="Descrição para o cliente (opcional)"
      >
        <textarea
          ref={descriptionRef}
          id={`${id}-description-client`}
          name="description_client"
          rows={2}
          maxLength={2000}
          defaultValue={workstream?.description_client ?? ""}
          onInput={(e) => setDescription(e.currentTarget.value)}
          className={textareaClass}
        />
      </Field>

      <div aria-live="polite" className="flex flex-col gap-2">
        {issues.length > 0 ? (
          <div className="flex items-start gap-2 rounded-lg bg-warn-soft p-3 text-sm text-warn-fg">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <span>
              O texto para o cliente cita{" "}
              {issues.map((issue) => describeIssue(issue)).join(", ")}. O
              cliente não deve ler isso.
            </span>
          </div>
        ) : null}
        {error ? <p className="text-sm text-danger-fg">{error}</p> : null}
      </div>

      {clientText ? (
        clientText.writer ? (
          <p className="text-xs text-ink-2">{clientText.writer}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={asking}
              onClick={ask}
              className="self-start"
            >
              {asking ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              Pedir sugestão ao Redator
            </Button>
            {suggestion ? (
              <div className="flex flex-col gap-2 rounded-lg border border-line bg-card p-3 text-sm">
                <p className="text-xs font-semibold text-ink-2">
                  Sugestão do Redator do Cliente
                </p>
                <p className="font-medium text-navy">{suggestion.title}</p>
                {suggestion.description ? (
                  <p className="text-ink">{suggestion.description}</p>
                ) : null}
                {suggestion.notes ? (
                  <p className="text-xs text-ink-2">{suggestion.notes}</p>
                ) : null}
                {suggestion.issues.length > 0 ? (
                  <p className="text-xs text-warn-fg">
                    Ainda cita{" "}
                    {uniqueIssues(suggestion.issues)
                      .map((issue) => describeIssue(issue))
                      .join(", ")}
                    : revise antes de salvar.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => use(suggestion)}
                  >
                    Usar a sugestão
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSuggestion(null)}
                  >
                    Descartar
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )
      ) : null}
    </div>
  );
}
