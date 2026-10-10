"use client";

import { useActionState, useId, useState } from "react";
import { Archive, Eye, LoaderCircle, Pencil, Plus } from "lucide-react";
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
import { salvarFrente } from "./actions";
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
};

export type WorkstreamFormOptions = {
  milestones: { code: string; title: string }[];
  departments: { slug: string; name: string }[];
  assignees: AssigneeOption[];
  /** Quem pode mostrar a frente ao cliente (workstream.visibility). */
  canShowClient: boolean;
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

          {options.canShowClient ? (
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
                Mostrar esta frente ao cliente no portal. As tarefas continuam
                só da equipe.
              </label>
              <Field
                id={`${id}-title-client`}
                label="Título para o cliente"
                hint="Obrigatório para mostrar. O portal nunca usa o título interno."
              >
                <input
                  id={`${id}-title-client`}
                  name="title_client"
                  maxLength={200}
                  defaultValue={workstream?.title_client ?? ""}
                  className={inputClass}
                />
              </Field>
              <Field
                id={`${id}-description-client`}
                label="Descrição para o cliente (opcional)"
              >
                <textarea
                  id={`${id}-description-client`}
                  name="description_client"
                  rows={2}
                  maxLength={2000}
                  defaultValue={workstream?.description_client ?? ""}
                  className={textareaClass}
                />
              </Field>
            </div>
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
