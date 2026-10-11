import { describe, expect, it } from "vitest";
import {
  looksLikeRequest,
  normalize,
  paletteItems,
  step,
  type SearchResult,
} from "./palette-items";

const RESULTS: SearchResult = {
  projects: [{ code: "EXE", name: "Atendimento com IA" }],
  tasks: [
    {
      code: "HUB-12",
      project_code: "EXE",
      title: "Mapear o caso de reagendamento",
      status_category: "todo",
    },
    {
      code: "HUB-5",
      project_code: "EXE",
      title: "Mapear as perguntas",
      status_category: "done",
    },
  ],
  milestones: [
    { id: "m1", project_code: "EXE", code: "M2", title: "Mapa pronto" },
  ],
  workstreams: [{ id: "w1", project_code: "EXE", title: "Mapeamento" }],
};

describe("janela ⌘K", () => {
  it("sem texto: ações e telas; novo projeto só para quem cadastra", () => {
    const base = paletteItems({
      query: "",
      results: null,
      canCreateProject: false,
    });
    expect(base[0]).toMatchObject({
      label: "Nova tarefa",
      action: "nova-tarefa",
    });
    expect(base.some((i) => i.label === "Novo projeto")).toBe(false);
    expect(
      base.filter((i) => i.group === "Telas").map((i) => i.href),
    ).toContain("/agentes");
    expect(
      paletteItems({ query: "", results: null, canCreateProject: true }).some(
        (i) => i.href === "/projetos/novo",
      ),
    ).toBe(true);
  });

  it("filtra telas sem diferenciar acento e maiúscula, também por palavra-chave", () => {
    const items = (query: string) =>
      paletteItems({ query, results: null, canCreateProject: false }).map(
        (i) => i.label,
      );
    expect(items("aprovacoes")).toEqual(["Aprovações"]);
    expect(items("CHAVES")).toEqual(["Sala de Controle"]);
    expect(items("suspender")).toEqual(["Configurações"]);
    expect(items("criar")).toEqual(["Nova tarefa"]);
  });

  it("monta os links da busca: projeto, tarefa no painel, marco e frente", () => {
    const items = paletteItems({
      query: "mapa",
      results: RESULTS,
      canCreateProject: false,
    });
    expect(items.map((i) => [i.group, i.label, i.hint, i.href])).toEqual([
      ["Projetos", "Atendimento com IA", "EXE", "/projetos/EXE"],
      [
        "Tarefas",
        "Mapear o caso de reagendamento",
        "HUB-12",
        "/projetos/EXE/lista?tarefa=HUB-12",
      ],
      [
        "Tarefas",
        "Mapear as perguntas",
        "HUB-5 · concluída",
        "/projetos/EXE/lista?tarefa=HUB-5",
      ],
      ["Marcos", "Mapa pronto", "EXE · M2", "/projetos/EXE"],
      ["Frentes", "Mapeamento", "EXE", "/projetos/EXE"],
    ]);
  });

  it("oferece o outro tema", () => {
    const label = (dark: boolean) =>
      paletteItems({
        query: "tema",
        results: null,
        canCreateProject: false,
        dark,
      }).map((i) => i.label);
    expect(label(false)).toEqual(["Usar o tema escuro"]);
    expect(label(true)).toEqual(["Usar o tema claro"]);
  });

  it("oferece o Concierge: primeiro numa frase, por último numa busca curta", () => {
    const items = (query: string, concierge: "ready" | "off" | null) =>
      paletteItems({
        query,
        results: RESULTS,
        canCreateProject: false,
        concierge,
      });
    const frase = items("cria uma tarefa de revisar o contrato", "ready");
    expect(frase[0]).toMatchObject({
      id: "concierge",
      group: "Concierge",
      label: "Pedir ao Concierge: “cria uma tarefa de revisar o contrato”",
      hint: "prévia antes de executar",
      action: "concierge",
    });
    const busca = items("mapa", "off");
    expect(busca.at(-1)).toMatchObject({
      id: "concierge",
      hint: "sem IA configurada",
    });
    expect(busca[0].group).not.toBe("Concierge");
    // Curto demais, ou antes de saber se o Concierge existe: não aparece.
    expect(items("ma", "ready").some((i) => i.id === "concierge")).toBe(false);
    expect(items("mapa", null).some((i) => i.id === "concierge")).toBe(false);
    expect(looksLikeRequest("abre o quadro")).toBe(true);
    expect(looksLikeRequest("HUB-12")).toBe(false);
  });

  it("setas dão a volta nas pontas", () => {
    expect(step(-1, 3, 1)).toBe(0);
    expect(step(-1, 3, -1)).toBe(2);
    expect(step(2, 3, 1)).toBe(0);
    expect(step(0, 3, -1)).toBe(2);
    expect(step(0, 0, 1)).toBe(-1);
    expect(normalize("  Ação ")).toBe("acao");
  });
});
