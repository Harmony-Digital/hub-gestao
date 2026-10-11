"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Download, Eye, LoaderCircle, Upload } from "lucide-react";
import { ErrorNote, textareaClass, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { MILESTONE_STATUS } from "@/lib/labels";
import { importarPlano } from "./actions";
import { IMPORT_IDLE, type ImportState } from "./state";

type Result = Extract<ImportState, { status: "ok" }>["result"];

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(MILESTONE_STATUS).map(([k, v]) => [k, v.label]),
);

/**
 * Importar o plan.md: colar ou escolher o arquivo, ver o que entra (nada é gravado) e
 * importar. "Importar" só vale depois da prévia do mesmo texto.
 */
export function ImportPlanForm({
  projectCode,
  planPath,
  initialText = "",
  templateId = null,
}: {
  projectCode: string;
  planPath: string;
  /** Texto inicial do campo (a proposta do Planejador, por exemplo). */
  initialText?: string;
  /** Modelo de onde veio o texto: os textos para o cliente dele entram junto (RF-36). */
  templateId?: string | null;
}) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const [state, action, pending] = useActionState(importarPlano, IMPORT_IDLE);
  const submit = useSubmit(action);
  const previewed =
    state.status === "ok" && state.result.dryRun && state.sent === text;
  const form = useRef<HTMLFormElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  // Com o esqueleto de um modelo, a prévia já abre pronta: falta só o Importar.
  const autoPreview = Boolean(templateId && initialText.trim());
  useEffect(() => {
    if (autoPreview) form.current?.requestSubmit(previewButton.current);
  }, [autoPreview]);

  const readFile = (file: File | undefined) => {
    if (!file) return;
    void file.text().then(setText);
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <form
        ref={form}
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5"
      >
        <input type="hidden" name="project" value={projectCode} />
        {templateId ? (
          <input type="hidden" name="modelo" value={templateId} />
        ) : null}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${id}-texto`}
            className="text-sm font-medium text-navy"
          >
            {templateId
              ? "Esqueleto do modelo (dá para ajustar antes de importar)"
              : `Conteúdo do ${planPath}`}
          </label>
          <textarea
            id={`${id}-texto`}
            name="markdown"
            rows={14}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={pending}
            spellCheck={false}
            placeholder={
              "# Plano\n\n## M1 — Primeiro marco\n### Frente\n- [ ] Tarefa"
            }
            className={`${textareaClass} font-mono text-xs`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-off-2 focus-within:ring-3 focus-within:ring-brand/30">
            <Upload aria-hidden="true" className="size-4" />
            Escolher o arquivo
            <input
              type="file"
              accept=".md,text/markdown,text/plain"
              className="sr-only"
              disabled={pending}
              onChange={(event) => readFile(event.target.files?.[0])}
            />
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              ref={previewButton}
              type="submit"
              name="intent"
              value="preview"
              variant="outline"
              size="lg"
              disabled={pending || !text.trim()}
            >
              {pending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Eye aria-hidden="true" />
              )}
              Ver o que entra
            </Button>
            <Button
              type="submit"
              name="intent"
              value="import"
              size="lg"
              disabled={pending || !previewed}
              title={
                previewed ? undefined : "Veja o que entra antes de importar."
              }
            >
              Importar
            </Button>
          </div>
        </div>
        <div aria-live="polite">
          {state.status === "error" ? (
            <ErrorNote message={state.message} />
          ) : null}
        </div>
      </form>

      {state.status === "ok" ? (
        <Outcome
          result={state.result}
          planPath={planPath}
          projectCode={projectCode}
          fromTemplate={Boolean(templateId)}
        />
      ) : null}
    </div>
  );
}

function Outcome({
  result,
  planPath,
  projectCode,
  fromTemplate,
}: {
  result: Result;
  planPath: string;
  projectCode: string;
  /** Veio de um modelo: não há arquivo de repositório para atualizar. */
  fromTemplate: boolean;
}) {
  const s = result.summary;
  const rows = [
    ["Marcos novos", s.milestones_created],
    ["Frentes novas", s.workstreams_created],
    ["Tarefas novas", s.created],
    ["Concluídas", s.completed],
    ["Itens ligados a tarefas que já existiam", s.linked],
  ] as const;
  return (
    <section
      aria-labelledby="resultado-importacao"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="resultado-importacao"
          className="font-heading text-base font-semibold text-navy"
        >
          {result.dryRun ? "O que entra (nada foi gravado)" : "Importado"}
        </h2>
        <p className="text-sm text-ink-2">
          {result.dryRun
            ? "Confira e clique em Importar. O aceite dos marcos continua sendo pedido e decidido nas Aprovações."
            : fromTemplate
              ? "Os marcos, as frentes e as tarefas do modelo já estão no projeto."
              : `Grave o arquivo abaixo no repositório, no lugar do ${planPath}: os itens passam a levar os códigos das tarefas.`}
        </p>
      </div>
      {!result.dryRun ? (
        <Button asChild size="lg" className="self-start">
          <Link href={`/projetos/${projectCode}/lista`}>
            Abrir as tarefas do projeto
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      ) : null}
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-2">{label}</dt>
            <dd className="font-mono text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {result.milestones.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {result.milestones.map((m) => (
            <li key={m.code} className="flex gap-2">
              <span className="w-10 font-mono text-xs font-semibold text-caption">
                {m.code}
              </span>
              <span className="flex-1 text-ink">{m.title}</span>
              <span className="text-xs text-ink-2">
                {STATUS_LABEL[m.status] ?? m.status}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {result.conflicts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold text-navy">
            Avisos ({result.conflicts.length})
          </h3>
          <ul className="flex flex-col gap-1 text-sm text-ink">
            {result.conflicts.map((c, i) => (
              <li key={`${c.kind}-${c.line}-${i}`}>
                {c.line ? (
                  <span className="font-mono text-xs text-caption">
                    linha {c.line}:{" "}
                  </span>
                ) : null}
                {c.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!result.dryRun && result.clientTexts > 0 ? (
        <p className="text-sm text-ink">
          {result.clientTexts === 1
            ? "1 texto para o cliente veio do modelo"
            : `${result.clientTexts} textos para o cliente vieram do modelo`}{" "}
          (marcos e frentes que ainda não tinham). Mostrar uma frente ao cliente
          continua sendo pedido de aprovação.
        </p>
      ) : null}
      {!result.dryRun && !fromTemplate ? (
        <PlanFile markdown={result.markdown} planPath={planPath} />
      ) : null}
    </section>
  );
}

function PlanFile({
  markdown,
  planPath,
}: {
  markdown: string;
  planPath: string;
}) {
  const id = useId();
  const name = planPath.split("/").at(-1) || "PLAN.md";
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={`${id}-arquivo`}
          className="text-sm font-medium text-navy"
        >
          {planPath} com os códigos
        </label>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download aria-hidden="true" />
          Baixar o {name}
        </Button>
      </div>
      <textarea
        id={`${id}-arquivo`}
        readOnly
        rows={12}
        value={markdown}
        className={`${textareaClass} font-mono text-xs`}
      />
    </div>
  );
}
