"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import { criarTarefa } from "@/app/(interno)/projetos/[code]/_tasks/actions";
import type { CreateTaskState } from "@/app/(interno)/projetos/[code]/_tasks/form";
import { ErrorNote, Field, inputClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { PRIORITY } from "@/lib/labels";

type ProjectOption = { code: string; name: string };

const IDLE: CreateTaskState = { status: "idle" };
const PROJECT_IN_PATH = /^\/projetos\/([A-Z0-9]{2,8})(?:\/|$)/;

/**
 * Nova tarefa de qualquer tela: escolhe o projeto (o da tela atual vem marcado), título,
 * prioridade e prazo. Criada, abre a tarefa no painel da Lista do projeto, onde dá para
 * completar o resto. Os projetos só são buscados quando a janela abre.
 */
export function QuickCreateDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // A janela fica em estado, não em ref: o efeito abaixo a abre e fecha.
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open, dialog]);

  useEffect(() => {
    if (!open || projects) return;
    const controller = new AbortController();
    fetch("/busca/projetos", { cache: "no-store", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((body: { projects?: ProjectOption[] }) =>
        setProjects(body.projects ?? []),
      )
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadError(
            "Não deu para carregar os projetos. Feche e abra de novo.",
          );
        }
      });
    return () => controller.abort();
  }, [open, projects]);

  return (
    <dialog
      ref={setDialog}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(92vw,30rem)] max-w-none rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-navy-3/50"
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2
            id={titleId}
            className="font-heading text-lg font-semibold text-navy"
          >
            Nova tarefa
          </h2>
          <p className="text-sm text-ink-2">
            Depois de criar, a tarefa abre no projeto para completar o resto.
          </p>
        </div>
        {open ? (
          loadError ? (
            <ErrorNote message={loadError} />
          ) : projects === null ? (
            <p className="flex items-center gap-2 text-sm text-caption">
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin"
              />
              Carregando os projetos…
            </p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-ink-2">
              Você ainda não participa de nenhum projeto ativo.
            </p>
          ) : (
            <QuickCreateForm projects={projects} onClose={onClose} />
          )
        ) : null}
      </div>
    </dialog>
  );
}

function QuickCreateForm({
  projects,
  onClose,
}: {
  projects: ProjectOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const id = useId();
  // O formulário só existe com a janela aberta (no navegador): dá para ler o endereço.
  const [initialProject] = useState(() => {
    const code = PROJECT_IN_PATH.exec(window.location.pathname)?.[1];
    return code && projects.some((p) => p.code === code) ? code : "";
  });
  const [state, action, pending] = useActionState(
    async (previous: CreateTaskState, form: FormData) => {
      const result = await criarTarefa(previous, form);
      if (result.status === "created") {
        onClose();
        router.push(
          `/projetos/${String(form.get("project"))}/lista?tarefa=${result.code}`,
        );
      }
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
        <Field id={`${id}-project`} label="Projeto">
          <select
            id={`${id}-project`}
            name="project"
            required
            defaultValue={initialProject}
            className={inputClass}
          >
            <option value="" disabled>
              Escolha o projeto
            </option>
            {projects.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-title`} label="Título">
          <input
            id={`${id}-title`}
            name="title"
            required
            maxLength={300}
            autoFocus
            placeholder="O que precisa ser feito"
            className={inputClass}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={`${id}-priority`} label="Prioridade">
            <select
              id={`${id}-priority`}
              name="priority"
              defaultValue="normal"
              className={inputClass}
            >
              {(["urgent", "high", "normal", "low"] as const).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY[p].label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-due`} label="Prazo (opcional)">
            <input
              id={`${id}-due`}
              type="date"
              name="due_date"
              className={inputClass}
            />
          </Field>
        </div>
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
