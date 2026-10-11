import { describe, expect, it } from "vitest";
import { checkClientText } from "@/modules/client-text/check";
import { renderSummary, type PeriodFacts } from "./summary-text";

const facts: PeriodFacts = {
  delivered: [
    {
      code: "M1",
      title: "Descoberta interna",
      titleClient: "Mapa do site aprovado",
      client: true,
    },
    { code: "M2", title: "Ajuste técnico", titleClient: null, client: false },
  ],
  next: {
    code: "M3",
    title: "Construção",
    titleClient: "Site no ambiente de teste",
    client: true,
    due: "2026-11-20",
  },
  nextClient: { titleClient: "Site no ambiente de teste", due: "2026-11-20" },
  completed: [
    { code: "HUB-12", title: "Fazer o briefing" },
    { code: "HUB-13", title: "Revisar textos" },
  ],
  blocked: [
    { code: "HUB-22", title: "Página inicial", reason: "Falta o logotipo." },
  ],
};

describe("resumo do período para relatório", () => {
  it("para o cliente: só o que ele vê, sem código nem bloqueio, e passa no RC-12", () => {
    const text = renderSummary(facts, "client", "2026-10-05", "2026-10-11");
    expect(text).toContain("## Andamento de 05/10/2026 a 11/10/2026");
    expect(text).toContain("concluiu 2 etapas");
    expect(text).toContain("- Mapa do site aprovado");
    expect(text).toContain(
      "**Próxima entrega:** Site no ambiente de teste, prevista para 20/11/2026.",
    );
    for (const internal of [
      "HUB-",
      "M2",
      "Ajuste técnico",
      "logotipo",
      "Descoberta interna",
    ]) {
      expect(text).not.toContain(internal);
    }
    expect(
      checkClientText(text, {
        taskPrefix: "HUB",
        agentNames: ["Kratos"],
        otherClients: [],
      }),
    ).toEqual([]);
  });

  it("interno: entregas, tarefas com código, bloqueios e o próximo marco", () => {
    const text = renderSummary(facts, "internal", "2026-10-05", "2026-10-11");
    expect(text).toContain("- M1 Descoberta interna");
    expect(text).toContain("**Tarefas concluídas (2):**");
    expect(text).toContain("- HUB-22 Página inicial: Falta o logotipo.");
    expect(text).toContain("**Próximo marco:** M3 Construção, 20/11/2026.");
  });

  it("período sem nada: frases que continuam fazendo sentido", () => {
    const empty: PeriodFacts = {
      delivered: [],
      next: null,
      nextClient: null,
      completed: [],
      blocked: [],
    };
    expect(
      renderSummary(empty, "client", "2026-10-05", "2026-10-11"),
    ).toContain("seguiu trabalhando nas próximas entregas");
    expect(
      renderSummary(empty, "internal", "2026-10-05", "2026-10-11"),
    ).toContain("**Tarefas concluídas (0):**");
  });
});
