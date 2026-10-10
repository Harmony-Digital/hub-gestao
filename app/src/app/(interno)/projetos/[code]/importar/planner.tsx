"use client";

import { useActionState, useId, useState } from "react";
import {
  ArrowDown,
  CircleCheck,
  LoaderCircle,
  Sparkles,
  Upload,
} from "lucide-react";
import { ErrorNote, textareaClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { proporPlano } from "./planner-actions";
import { PLANNER_IDLE } from "./planner-state";

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Planejador (PL-11): do documento (PRD, brief, transcrição) para a proposta no formato
 * do plan.md. A proposta vai para o campo de importação abaixo, onde a pessoa revisa,
 * edita, vê o que entra e importa. Nada é criado aqui.
 */
export function PlannerCard({
  projectCode,
  ready,
  onUse,
}: {
  projectCode: string;
  /** null: pronto; texto: por que o Planejador não está ligado. */
  ready: string | null;
  onUse: (markdown: string) => void;
}) {
  const id = useId();
  const [document, setDocument] = useState("");
  const [used, setUsed] = useState(false);
  const [state, action, pending] = useActionState(
    async (previous: Parameters<typeof proporPlano>[0], form: FormData) => {
      setUsed(false);
      return proporPlano(previous, form);
    },
    PLANNER_IDLE,
  );
  const submit = useSubmit(action);

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className="flex max-w-4xl flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id={`${id}-titulo`}
          className="flex items-center gap-2 font-heading text-lg font-semibold text-navy"
        >
          <Sparkles aria-hidden="true" className="size-5 text-brand-strong" />
          Propor com o Planejador
        </h2>
        <p className="text-sm text-ink-2">
          Cole um PRD, um brief ou a transcrição de uma reunião. O Planejador
          (PL-11) propõe marcos, frentes, tarefas e critérios de aceite no
          formato do plan.md. Nada é criado: a proposta vai para o campo de
          importação, onde você confere, edita e importa.
        </p>
      </div>
      {ready ? (
        <p className="rounded-lg border border-dashed border-line p-3 text-sm text-ink-2">
          {ready}
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input type="hidden" name="project" value={projectCode} />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={`${id}-documento`}
              className="text-sm font-medium text-navy"
            >
              Documento
            </label>
            <textarea
              id={`${id}-documento`}
              name="document"
              rows={8}
              value={document}
              onChange={(event) => setDocument(event.target.value)}
              disabled={pending}
              placeholder="Objetivo, escopo, prazos e o que o cliente precisa ver funcionando."
              className={textareaClass}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-off-2 focus-within:ring-3 focus-within:ring-brand/30">
              <Upload aria-hidden="true" className="size-4" />
              Escolher o arquivo
              <input
                type="file"
                accept=".md,.txt,text/markdown,text/plain"
                className="sr-only"
                disabled={pending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void file.text().then(setDocument);
                }}
              />
            </label>
            <Button
              type="submit"
              size="lg"
              className="ml-auto"
              disabled={pending || document.trim().length === 0}
            >
              {pending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              {pending ? "Planejando…" : "Pedir a proposta"}
            </Button>
          </div>
        </form>
      )}
      <div aria-live="polite" className="flex flex-col gap-3">
        {state.status === "error" ? (
          <ErrorNote message={state.message} />
        ) : null}
        {state.status === "ok" ? (
          <div className="flex flex-col gap-3 rounded-xl bg-off p-3">
            <p className="text-sm text-ink">
              Proposta pronta:{" "}
              {[
                plural(state.counts.milestones, "marco", "marcos"),
                plural(state.counts.workstreams, "frente", "frentes"),
                plural(state.counts.tasks, "tarefa", "tarefas"),
              ].join(", ")}
              {state.counts.subtasks
                ? ` e ${plural(state.counts.subtasks, "subtarefa", "subtarefas")}`
                : ""}
              . Custo da chamada: {money.format(state.costUsd)}.
            </p>
            {state.assumptions.length ? (
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-navy">
                  Premissas e dúvidas para conferir
                </p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-2">
                  {state.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onUse(state.markdown);
                  setUsed(true);
                }}
              >
                <ArrowDown aria-hidden="true" />
                Levar para a importação
              </Button>
              {used ? (
                <span className="flex items-center gap-1.5 text-sm text-ok-fg">
                  <CircleCheck aria-hidden="true" className="size-4" />
                  No campo abaixo: confira, edite e clique em Ver o que entra.
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
