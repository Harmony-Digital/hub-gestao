"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import { FilePlus2, LoaderCircle, Send, Sparkles } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import {
  ErrorNote,
  Field,
  inputClass,
  textareaClass,
  useSubmit,
} from "@/components/forms";
import { Button } from "@/components/ui/button";
import { IDLE } from "@/lib/action-state";
import { montarResumo, prepararRelatorio } from "./actions";

type Props = {
  projects: { code: string; name: string }[];
  /** Período padrão: os últimos 7 dias, terminando hoje (fuso do workspace). */
  defaultStart: string;
  defaultEnd: string;
};

/**
 * Preparar relatório (pessoa): escolher projeto, período e para quem, montar o resumo
 * com o que o Hub registrou (sem IA), revisar o texto e mandar para as Aprovações. É o
 * mesmo caminho dos rascunhos dos agentes: aprovar publica.
 */
export function NewReportButton(props: Props) {
  return (
    <FormDialog
      label="Preparar relatório"
      icon={<FilePlus2 aria-hidden="true" />}
      variant="default"
      wide
      title="Preparar relatório"
      description="Monte o resumo do período, ajuste o texto e mande para as Aprovações. Aprovar publica (no portal, se for para o cliente)."
    >
      {(close) => <NewReportForm {...props} onDone={close} />}
    </FormDialog>
  );
}

function NewReportForm({
  projects,
  defaultStart,
  defaultEnd,
  onDone,
}: Props & { onDone: () => void }) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [body, setBody] = useState("");
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [building, startBuilding] = useTransition();
  const [state, action, pending] = useActionState(
    async (
      previous: Parameters<typeof prepararRelatorio>[0],
      data: FormData,
    ) => {
      const result = await prepararRelatorio(previous, data);
      if (result.status === "ok") onDone();
      return result;
    },
    IDLE,
  );
  const submit = useSubmit(action);

  const buildSummary = () => {
    if (!form.current) return;
    const data = new FormData(form.current);
    setSummaryError(null);
    startBuilding(async () => {
      const result = await montarResumo(data);
      if (result.status === "ok") setBody(result.text);
      else if (result.status === "error") setSummaryError(result.message);
    });
  };

  if (projects.length === 0) {
    return (
      <p className="text-sm text-ink-2">
        Nenhum projeto ativo em que você possa preparar relatório.
      </p>
    );
  }

  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-4">
      <Field id={`${id}-projeto`} label="Projeto">
        <select
          id={`${id}-projeto`}
          name="project"
          required
          defaultValue={projects[0]?.code}
          className={inputClass}
        >
          {projects.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-inicio`} label="Início do período">
          <input
            id={`${id}-inicio`}
            type="date"
            name="start"
            required
            defaultValue={defaultStart}
            className={inputClass}
          />
        </Field>
        <Field id={`${id}-fim`} label="Fim do período">
          <input
            id={`${id}-fim`}
            type="date"
            name="end"
            required
            defaultValue={defaultEnd}
            className={inputClass}
          />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium text-navy">Para quem</legend>
        <div className="flex flex-wrap gap-4 text-sm text-ink">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="audience" value="client" defaultChecked />
            Para o cliente (sai no portal)
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="audience" value="internal" />
            Interno (só a equipe)
          </label>
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor={`${id}-texto`}
            className="text-sm font-medium text-navy"
          >
            Texto do relatório
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={buildSummary}
            disabled={building || pending}
          >
            {building ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
            Montar o resumo
          </Button>
        </div>
        <textarea
          id={`${id}-texto`}
          name="body"
          rows={12}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={pending}
          placeholder="Clique em Montar o resumo para começar com o que aconteceu no período, ou escreva aqui. Markdown: **negrito**, - lista."
          className={textareaClass}
        />
        <p className="text-xs text-caption">
          O resumo usa só o que o Hub registrou: entregas, tarefas concluídas e
          a próxima entrega. Para o cliente, sai sem códigos nem nada interno.
        </p>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {summaryError ? <ErrorNote message={summaryError} /> : null}
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={onDone}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" size="lg" disabled={pending || !body.trim()}>
          {pending ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Send aria-hidden="true" />
          )}
          Mandar para aprovação
        </Button>
      </div>
    </form>
  );
}
