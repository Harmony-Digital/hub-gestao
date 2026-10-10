import { describe, expect, it } from "vitest";
import { parsePlanFile } from "@/modules/sync/plan-file";
import type { PlanProposal } from "./proposal";
import {
  cleanTitle,
  LIMITS,
  nextMilestoneNumber,
  plannerMessage,
  renderPlan,
  type PlannerContext,
} from "./render";

const CTX: PlannerContext = {
  today: "2026-10-10",
  project: {
    code: "CER",
    name: "Certato",
    client: "MMA",
    objective: "Relatórios de governo\nsem retrabalho.",
  },
  milestones: [
    { code: "M1", title: "Fundação" },
    { code: "M2", title: "Publicação" },
  ],
  departments: [
    { slug: "desenvolvimento", name: "Desenvolvimento" },
    { slug: "design", name: "Design" },
  ],
};

const PROPOSAL: PlanProposal = {
  milestones: [
    {
      title: "Painel de relatórios",
      due_date: "2026-11-13",
      acceptance_criteria: [
        "O cliente gera o relatório mensal sozinho",
        "Exportação em PDF",
      ],
      client_title: "Seu painel de relatórios",
      client_summary: "Você gera o relatório do mês em poucos cliques.",
      workstreams: [
        {
          title: "Interface do painel",
          department: "design",
          tasks: [
            {
              title: "Desenhar a tela do painel",
              subtasks: ["Rascunho", "Versão final"],
            },
            { title: "Validar com o cliente", subtasks: [] },
          ],
        },
        {
          title: "Geração do PDF",
          department: "Desenvolvimento",
          tasks: [{ title: "Gerar o PDF do relatório", subtasks: [] }],
        },
      ],
    },
    {
      title: "Treinamento — equipe do cliente",
      due_date: "não sei",
      acceptance_criteria: [],
      client_title: null,
      client_summary: null,
      workstreams: [
        {
          title: "Material",
          department: "comercial",
          tasks: [{ title: "- [ ] Escrever o roteiro (HUB-9)", subtasks: [] }],
        },
      ],
    },
  ],
  assumptions: ["O cliente já tem os dados do mês anterior?"],
};

describe("Planejador: a proposta no formato do plan.md", () => {
  it("numera depois dos marcos que existem, marca sugestões e limpa os títulos", () => {
    const plan = renderPlan(PROPOSAL, CTX);
    expect(plan.counts).toEqual({
      milestones: 2,
      workstreams: 3,
      tasks: 4,
      subtasks: 2,
    });
    expect(plan.assumptions).toEqual([
      "O cliente já tem os dados do mês anterior?",
    ]);
    expect(plan.markdown).toBe(
      [
        "# Plano de Certato",
        "",
        "> Proposta do Planejador (PL-11) em 10/10/2026, a partir do documento enviado. Nada foi criado no Hub: confira, edite e importe. Prazos e textos para o cliente são sugestões.",
        "",
        "## M3 — Painel de relatórios",
        "",
        "Prazo sugerido: 13/11/2026 (sexta-feira). É sugestão do Planejador: o prazo do marco é decisão de vocês.",
        "",
        "> Para o cliente (sugestão; só aparece no portal depois de aprovado): Seu painel de relatórios. Você gera o relatório do mês em poucos cliques.",
        "",
        "### Interface do painel",
        "",
        "Departamento sugerido: Design.",
        "",
        "- [ ] Desenhar a tela do painel",
        "  - [ ] Rascunho",
        "  - [ ] Versão final",
        "- [ ] Validar com o cliente",
        "",
        "### Geração do PDF",
        "",
        "Departamento sugerido: Desenvolvimento.",
        "",
        "- [ ] Gerar o PDF do relatório",
        "",
        "### 🔒 GATE M3 (critérios de aceite)",
        "",
        "- [ ] O cliente gera o relatório mensal sozinho",
        "- [ ] Exportação em PDF",
        "",
        "## M4 — Treinamento - equipe do cliente",
        "",
        "### Material",
        "",
        "- [ ] Escrever o roteiro",
        "",
        "## Premissas e dúvidas do Planejador",
        "",
        "<!-- hub: ignorar -->",
        "",
        "- O cliente já tem os dados do mês anterior?",
        "",
      ].join("\n"),
    );
  });

  it("o texto sai pronto para a importação: o leitor do plan.md vê os marcos, as frentes, as tarefas e o GATE", () => {
    const parsed = parsePlanFile(renderPlan(PROPOSAL, CTX).markdown, {
      prefix: "HUB",
    });
    expect(parsed.milestones.map((m) => [m.code, m.title])).toEqual([
      ["M3", "Painel de relatórios"],
      ["M4", "Treinamento - equipe do cliente"],
    ]);
    expect(parsed.workstreams.map((w) => w.title)).toEqual([
      "Interface do painel",
      "Geração do PDF",
      "Material",
    ]);
    expect(parsed.gates).toHaveLength(1);
    const kinds = parsed.items.map((i) => [i.title, i.kind]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ["Desenhar a tela do painel", "task"],
        ["Rascunho", "task"],
        ["O cliente gera o relatório mensal sozinho", "criterion"],
        ["Escrever o roteiro", "task"],
      ]),
    );
    // As premissas ficam como texto livre (seção ignorada).
    expect(parsed.items.some((i) => i.title.includes("dados do mês"))).toBe(
      false,
    );
  });

  it("corta os excessos e respeita os limites", () => {
    const many: PlanProposal = {
      milestones: Array.from({ length: 12 }, (_, i) => ({
        title: `Marco ${i + 1}`,
        due_date: null,
        acceptance_criteria: [],
        client_title: null,
        client_summary: null,
        workstreams: Array.from({ length: 9 }, (_, j) => ({
          title: `Frente ${j + 1}`,
          department: null,
          tasks: Array.from({ length: 14 }, (_, k) => ({
            title: `Tarefa ${k + 1}`,
            subtasks: [],
          })),
        })),
      })),
      assumptions: [],
    };
    const plan = renderPlan(many, { ...CTX, milestones: [] });
    expect(plan.counts).toEqual({
      milestones: LIMITS.milestones,
      workstreams: LIMITS.milestones * LIMITS.workstreams,
      tasks: LIMITS.milestones * LIMITS.workstreams * LIMITS.tasks,
      subtasks: 0,
    });
    expect(plan.markdown).toContain("## M1 — Marco 1");
  });

  it("títulos seguros e o próximo número de marco", () => {
    expect(cleanTitle("  ## Título\ncom quebra  ")).toBe("Título com quebra");
    expect(cleanTitle("~~riscado~~ [x] feito (HUB-12)")).toBe("riscado feito");
    expect(cleanTitle("Uma — nota")).toBe("Uma - nota");
    expect(cleanTitle("x".repeat(250))).toHaveLength(200);
    expect(nextMilestoneNumber([])).toBe(1);
    expect(nextMilestoneNumber([{ code: "M2" }, { code: "M10" }])).toBe(11);
  });

  it("a mensagem leva o projeto, os marcos que existem, os departamentos e o documento por último", () => {
    const message = plannerMessage(CTX, "  O cliente quer relatórios.  ");
    expect(message.split("\n")).toEqual([
      "HOJE: sábado, 2026-10-10",
      "PROJETO: CER · Certato · cliente MMA",
      "OBJETIVO DO PROJETO: Relatórios de governo sem retrabalho.",
      "MARCOS EXISTENTES:",
      "- M1 · Fundação",
      "- M2 · Publicação",
      "DEPARTAMENTOS (slug · nome):",
      "- desenvolvimento · Desenvolvimento",
      "- design · Design",
      "DOCUMENTO:",
      "O cliente quer relatórios.",
    ]);
  });
});
