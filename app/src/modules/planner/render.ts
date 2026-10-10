import { formatDate } from "@/lib/format";
import { weekdayOf } from "@/modules/concierge/context";
import { isoDate, plain } from "@/modules/concierge/resolve";
import type { PlanProposal } from "./proposal";

/**
 * O Planejador escreve a proposta no formato do plan.md (docs/plan-md.md), para a pessoa
 * revisar, editar e importar pela tela de sempre. Tudo aqui é determinístico: a IA
 * propõe a árvore; o Hub numera os marcos depois dos que existem, limpa os títulos (uma
 * linha, sem marcação que o leitor do plan.md interpretaria), corta os excessos e marca
 * prazos e textos para o cliente como sugestão. Puro.
 */

export type PlannerContext = {
  /** Hoje no fuso do workspace (AAAA-MM-DD). */
  today: string;
  project: {
    code: string;
    name: string;
    client: string;
    objective: string | null;
  };
  /** Marcos que o projeto já tem (código e título). */
  milestones: { code: string; title: string }[];
  departments: { slug: string; name: string }[];
};

/** Limites da proposta: o bastante para começar, sem virar um plano de 300 itens. */
export const LIMITS = {
  milestones: 8,
  workstreams: 6,
  tasks: 10,
  subtasks: 6,
  criteria: 6,
  assumptions: 12,
};

const oneLine = (text: string | null | undefined) =>
  (text ?? "").replace(/\s+/g, " ").trim();

/**
 * Título seguro para o plan.md: uma linha, sem caixa, código de tarefa, risco, título
 * de seção ou travessão com espaços (que o leitor do plan.md trata como início da nota).
 */
export function cleanTitle(text: string | null | undefined, max = 200): string {
  const clean = oneLine(text)
    .replace(/\[[ xX]\]/g, "")
    .replace(/\(\s*[A-Za-z]{2,6}-\d+\s*\)/g, "")
    .replace(/~~/g, "")
    .replace(/<!--|-->/g, "")
    .replace(/\s[—–]\s/g, " - ")
    .replace(/^[\s#>*+-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** O próximo número livre de marco (M1, M2...), depois dos que o projeto já tem. */
export function nextMilestoneNumber(existing: { code: string }[]): number {
  const numbers = existing
    .map((m) => /^M(\d{1,3})$/.exec(m.code)?.[1])
    .filter((n): n is string => Boolean(n))
    .map(Number);
  return (numbers.length ? Math.max(...numbers) : 0) + 1;
}

function department(
  value: string | null,
  ctx: PlannerContext,
): { slug: string; name: string } | null {
  if (!value) return null;
  const wanted = plain(value);
  return (
    ctx.departments.find(
      (d) => d.slug === value.trim() || plain(d.name) === wanted,
    ) ?? null
  );
}

export type RenderedPlan = {
  markdown: string;
  counts: {
    milestones: number;
    workstreams: number;
    tasks: number;
    subtasks: number;
  };
  assumptions: string[];
};

export function renderPlan(
  proposal: PlanProposal,
  ctx: PlannerContext,
): RenderedPlan {
  const counts = { milestones: 0, workstreams: 0, tasks: 0, subtasks: 0 };
  const out: string[] = [
    `# Plano de ${cleanTitle(ctx.project.name) || ctx.project.code}`,
    "",
    `> Proposta do Planejador (PL-11) em ${formatDate(ctx.today)}, a partir do documento enviado. Nada foi criado no Hub: confira, edite e importe. Prazos e textos para o cliente são sugestões.`,
    "",
  ];
  let next = nextMilestoneNumber(ctx.milestones);
  for (const milestone of proposal.milestones) {
    if (counts.milestones >= LIMITS.milestones || next > 999) break;
    const title = cleanTitle(milestone.title);
    if (!title) continue;
    const code = `M${next++}`;
    counts.milestones++;
    out.push(`## ${code} — ${title}`, "");
    const due = isoDate(milestone.due_date);
    if (due) {
      out.push(
        `Prazo sugerido: ${formatDate(due)} (${weekdayOf(due)}). É sugestão do Planejador: o prazo do marco é decisão de vocês.`,
        "",
      );
    }
    const clientTitle = cleanTitle(milestone.client_title);
    const clientSummary = cleanTitle(milestone.client_summary, 400);
    if (clientTitle || clientSummary) {
      out.push(
        `> Para o cliente (sugestão; só aparece no portal depois de aprovado): ${[clientTitle, clientSummary].filter(Boolean).join(". ")}`,
        "",
      );
    }
    for (const workstream of milestone.workstreams.slice(
      0,
      LIMITS.workstreams,
    )) {
      const wsTitle = cleanTitle(workstream.title);
      if (!wsTitle || /GATE\b/.test(wsTitle)) continue;
      counts.workstreams++;
      out.push(`### ${wsTitle}`, "");
      const dept = department(workstream.department, ctx);
      if (dept) out.push(`Departamento sugerido: ${dept.name}.`, "");
      for (const task of workstream.tasks.slice(0, LIMITS.tasks)) {
        const taskTitle = cleanTitle(task.title);
        if (!taskTitle) continue;
        counts.tasks++;
        out.push(`- [ ] ${taskTitle}`);
        for (const sub of task.subtasks.slice(0, LIMITS.subtasks)) {
          const subTitle = cleanTitle(sub);
          if (!subTitle) continue;
          counts.subtasks++;
          out.push(`  - [ ] ${subTitle}`);
        }
      }
      out.push("");
    }
    const criteria = milestone.acceptance_criteria
      .slice(0, LIMITS.criteria)
      .map((c) => cleanTitle(c))
      .filter(Boolean);
    if (criteria.length) {
      out.push(`### 🔒 GATE ${code} (critérios de aceite)`, "");
      out.push(...criteria.map((c) => `- [ ] ${c}`), "");
    }
  }
  const assumptions = proposal.assumptions
    .map((a) => cleanTitle(a, 300))
    .filter(Boolean)
    .slice(0, LIMITS.assumptions);
  if (assumptions.length) {
    out.push(
      "## Premissas e dúvidas do Planejador",
      "",
      "<!-- hub: ignorar -->",
      "",
      ...assumptions.map((a) => `- ${a}`),
      "",
    );
  }
  return { markdown: `${out.join("\n").trimEnd()}\n`, counts, assumptions };
}

/** A mensagem do pedido: o contexto e, por último, o documento. */
export function plannerMessage(ctx: PlannerContext, document: string): string {
  return [
    `HOJE: ${weekdayOf(ctx.today)}, ${ctx.today}`,
    `PROJETO: ${ctx.project.code} · ${oneLine(ctx.project.name)} · cliente ${oneLine(ctx.project.client)}`,
    ...(ctx.project.objective
      ? [`OBJETIVO DO PROJETO: ${oneLine(ctx.project.objective)}`]
      : []),
    "MARCOS EXISTENTES:",
    ...(ctx.milestones.length
      ? ctx.milestones.map((m) => `- ${m.code} · ${oneLine(m.title)}`)
      : ["(nenhum)"]),
    "DEPARTAMENTOS (slug · nome):",
    ...ctx.departments.map((d) => `- ${d.slug} · ${oneLine(d.name)}`),
    "DOCUMENTO:",
    document.trim(),
  ].join("\n");
}
