"use client";

import { useState } from "react";
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
}: {
  projectCode: string;
  planPath: string;
  /** null: Planejador pronto; texto: por que não está ligado. */
  planner: string | null;
}) {
  const [proposal, setProposal] = useState<{ id: number; text: string } | null>(
    null,
  );
  return (
    <>
      <PlannerCard
        projectCode={projectCode}
        ready={planner}
        onUse={(text) => setProposal({ id: Date.now(), text })}
      />
      <ImportPlanForm
        key={proposal?.id ?? 0}
        projectCode={projectCode}
        planPath={planPath}
        initialText={proposal?.text ?? ""}
      />
    </>
  );
}
