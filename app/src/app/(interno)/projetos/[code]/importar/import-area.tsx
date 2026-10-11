"use client";

import Link from "next/link";
import { useState } from "react";
import { LayoutTemplate } from "lucide-react";
import { ImportPlanForm } from "./import-form";
import { PlannerCard } from "./planner";

/**
 * Planejador e importação na mesma tela: a proposta do Planejador vai para o campo de
 * importação (que recomeça com ela), e o resto é o caminho de sempre: Ver o que entra e
 * Importar.
 */
export function ImportArea({
  projectCode,
  planPath,
  planner,
  templates = [],
  template = null,
}: {
  projectCode: string;
  planPath: string;
  /** null: Planejador pronto; texto: por que não está ligado. */
  planner: string | null;
  /** Modelos de projeto do workspace (quem pode importar vê). */
  templates?: { id: string; name: string }[];
  /** Modelo escolhido (`?modelo=`): o esqueleto começa no campo de importação. */
  template?: { id: string; name: string; markdown: string } | null;
}) {
  // O texto no campo é do modelo (até o Planejador trocar): os textos dele entram junto.
  const [proposal, setProposal] = useState<{
    id: number;
    text: string;
    template: string | null;
  } | null>(
    template ? { id: 1, text: template.markdown, template: template.id } : null,
  );
  return (
    <>
      {templates.length > 0 ? (
        <section
          aria-labelledby="usar-modelo"
          className="flex max-w-4xl flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
        >
          <h2
            id="usar-modelo"
            className="flex items-center gap-2 font-heading text-lg font-semibold text-navy"
          >
            <LayoutTemplate aria-hidden="true" className="size-5" />
            Usar um modelo
          </h2>
          {template ? (
            <p className="text-sm text-ink">
              O esqueleto do modelo “{template.name}” está no campo abaixo: veja
              o que entra e importe.
            </p>
          ) : (
            <p className="text-sm text-ink-2">
              Leva o esqueleto do modelo (marcos, frentes com o departamento,
              tarefas e critérios de aceite) para o campo abaixo.
            </p>
          )}
          <ul className="flex flex-wrap gap-2">
            {templates.map((tpl) => (
              <li key={tpl.id}>
                <Link
                  href={`/projetos/${projectCode}/importar?modelo=${tpl.id}`}
                  aria-current={tpl.id === template?.id ? "true" : undefined}
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm ${
                    tpl.id === template?.id
                      ? "border-navy bg-navy font-semibold text-off"
                      : "border-line text-ink hover:bg-off"
                  }`}
                >
                  {tpl.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <PlannerCard
        projectCode={projectCode}
        ready={planner}
        onUse={(text) => setProposal({ id: Date.now(), text, template: null })}
      />
      <ImportPlanForm
        key={proposal?.id ?? 0}
        projectCode={projectCode}
        planPath={planPath}
        initialText={proposal?.text ?? ""}
        templateId={proposal?.template ?? null}
      />
    </>
  );
}
