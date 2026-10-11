import { cleanTitle } from "@/modules/planner/render";
import { parsePlanFile } from "@/modules/sync/plan-file";

/**
 * Modelo de projeto (PRD §7.15, RF-36 e RF-37), a parte pura: o esqueleto é um texto no
 * formato do `plan.md` (marcos, frentes com o departamento, tarefas, subtarefas e os
 * critérios de aceite no GATE), aplicado pela importação de sempre, com prévia. Aqui ficam
 * a conferência do texto, as contas e a escrita do esqueleto a partir de um projeto.
 */

export const TEMPLATE_MARKDOWN_MAX = 60_000;

export type TemplateCounts = {
  milestones: number;
  workstreams: number;
  tasks: number;
  subtasks: number;
};

export function templateCounts(markdown: string): TemplateCounts {
  const parsed = parsePlanFile(markdown);
  const tasks = parsed.items.filter((i) => i.kind === "task" && !i.struck);
  return {
    milestones: parsed.milestones.length,
    workstreams: parsed.workstreams.length,
    tasks: tasks.filter((i) => i.depth === 0).length,
    subtasks: tasks.filter((i) => i.depth === 1).length,
  };
}

/**
 * O que impede o texto de ser um modelo, ou null. Esqueleto: pelo menos um marco com uma
 * tarefa, nenhuma caixa marcada e nenhum código de tarefa (código liga a tarefas de outro
 * projeto na importação).
 */
export function templateProblem(
  markdown: string,
  prefix = "HUB",
): string | null {
  if (!markdown.trim()) return "Escreva o esqueleto do modelo.";
  if (markdown.length > TEMPLATE_MARKDOWN_MAX) {
    return `O modelo passou de ${TEMPLATE_MARKDOWN_MAX.toLocaleString("pt-BR")} caracteres.`;
  }
  const parsed = parsePlanFile(markdown, { prefix });
  if (parsed.milestones.length === 0) {
    return "O modelo precisa de pelo menos um marco (uma linha como “## M1 — Descoberta”).";
  }
  if (!parsed.items.some((i) => i.kind === "task")) {
    return "O modelo precisa de pelo menos uma tarefa (uma linha como “- [ ] Fazer o briefing”).";
  }
  if (parsed.items.some((i) => i.code)) {
    return `Tire os códigos de tarefa (como ${prefix}-12) do modelo: ele é um esqueleto, e código liga a tarefas que já existem.`;
  }
  if (parsed.items.some((i) => i.checked)) {
    return "No modelo, todas as caixas ficam desmarcadas (“- [ ]”): ele é o começo de um projeto.";
  }
  return null;
}

export type TemplateSource = {
  name: string;
  milestones: {
    title: string;
    criteria: string[];
    workstreams: TemplateWorkstream[];
  }[];
  unplanned: { workstreams: TemplateWorkstream[]; tasks: TemplateTask[] };
};

type TemplateWorkstream = {
  title: string;
  /** Nome do departamento, como aparece na tela. */
  department: string | null;
  tasks: TemplateTask[];
};

type TemplateTask = { title: string; subtasks: string[] };

/**
 * O esqueleto de um projeto no formato do `plan.md`: marcos numerados de novo (M1, M2...),
 * frentes com o departamento, tarefas e subtarefas desmarcadas e sem código, e os
 * critérios de aceite no GATE de cada marco. Frente sem tarefa fica de fora (a importação
 * só cria frente para tarefa).
 */
export function renderTemplate(source: TemplateSource): string {
  const out: string[] = [`# Modelo · ${cleanTitle(source.name)}`, ""];
  const tasks = (list: TemplateTask[]) => {
    for (const task of list) {
      const title = cleanTitle(task.title);
      if (!title) continue;
      out.push(`- [ ] ${title}`);
      for (const sub of task.subtasks) {
        const subTitle = cleanTitle(sub);
        if (subTitle) out.push(`  - [ ] ${subTitle}`);
      }
    }
  };
  const workstreams = (list: TemplateWorkstream[]) => {
    for (const ws of list) {
      const title = cleanTitle(ws.title);
      if (!title || /GATE\b/.test(title) || ws.tasks.length === 0) continue;
      out.push(`### ${title}`, "");
      if (ws.department)
        out.push(`Departamento: ${cleanTitle(ws.department)}.`, "");
      tasks(ws.tasks);
      out.push("");
    }
  };

  source.milestones.forEach((m, index) => {
    const code = `M${index + 1}`;
    out.push(`## ${code} — ${cleanTitle(m.title) || `Marco ${index + 1}`}`, "");
    workstreams(m.workstreams);
    const criteria = m.criteria.map((c) => cleanTitle(c)).filter(Boolean);
    if (criteria.length > 0) {
      out.push(`### GATE ${code} (critérios de aceite)`, "");
      for (const c of criteria) out.push(`- [ ] ${c}`);
      out.push("");
    }
  });

  const loose = source.unplanned.tasks.length > 0;
  if (source.unplanned.workstreams.some((w) => w.tasks.length > 0) || loose) {
    out.push("## Sem marco", "");
    workstreams(source.unplanned.workstreams);
    if (loose) {
      out.push("### Tarefas sem frente", "");
      tasks(source.unplanned.tasks);
      out.push("");
    }
  }
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}
