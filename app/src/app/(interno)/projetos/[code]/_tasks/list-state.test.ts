import { describe, expect, it } from "vitest";
import type { TaskDto } from "@/modules/tasks/schemas";
import {
  departmentViewQuery,
  groupTasks,
  hasFilters,
  listQuery,
  readListState,
  sortTasks,
  stateFor,
  toTaskFilter,
} from "./list-state";

const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
const W2 = "25b95e85-9cfb-450b-a73e-dccb362aacea";

function task(over: Partial<TaskDto> & { code: string }): TaskDto {
  return {
    id: over.code,
    project_code: "EXE",
    title: over.code,
    description_md: null,
    status: { id: "s", name: "A fazer", category: "todo", color: "#999" },
    priority: "normal",
    assignee: null,
    workstream: null,
    parent_code: null,
    start_date: null,
    due_date: null,
    estimate_minutes: null,
    sort_key: 0,
    source: "ui",
    external_ref: null,
    done_evidence: null,
    blocked_reason: null,
    completed_at: null,
    completed_by: null,
    created_by: { type: "user", id: ID, name: "Fábio" },
    version: 1,
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    archived_at: null,
    ...over,
  } as TaskDto;
}

describe("estado da lista no endereço", () => {
  it("lê os filtros válidos e ignora o resto", () => {
    expect(
      readListState({
        frente: ID,
        resp: `agent:${ID}`,
        prio: ["urgent,high", "low", "quase"],
        prazo: "atrasadas",
        busca: "  agenda ",
        agrupar: "responsavel",
        ordem: "prazo",
        col: "titulo,prazo,xyz",
      }),
    ).toEqual({
      frente: ID,
      depto: null,
      etiqueta: null,
      resp: `agent:${ID}`,
      prio: ["urgent", "high", "low"],
      prazo: "atrasadas",
      busca: "agenda",
      agrupar: "responsavel",
      ordem: "prazo",
      colunas: ["prazo"],
      raia: "nenhuma",
    });
    expect(readListState({ raia: "frente" }).raia).toBe("frente");
    expect(listQuery(readListState({ raia: "responsavel" })).toString()).toBe(
      "raia=responsavel",
    );
    const blank = readListState({
      frente: "x",
      resp: "user:1",
      agrupar: "cor",
    });
    expect(blank).toMatchObject({
      frente: null,
      resp: null,
      agrupar: "status",
      ordem: "padrao",
      colunas: ["frente", "responsavel", "prazo", "prioridade"],
    });
    expect(hasFilters(blank)).toBe(false);
    expect(readListState({ col: "titulo" }).colunas).toEqual([]);
  });

  it("monta o endereço só com o que difere do padrão, e volta igual", () => {
    const state = readListState({
      resp: "eu",
      prio: "urgent",
      col: "titulo,prazo",
    });
    const query = listQuery(state);
    expect(query.toString()).toBe("resp=eu&prio=urgent&col=titulo%2Cprazo");
    expect(readListState(Object.fromEntries(query))).toEqual(state);
    expect(listQuery(readListState({})).toString()).toBe("");
  });

  it("filtra por etiqueta (nome, sem espaços sobrando)", () => {
    const state = readListState({ etiqueta: "  Cliente   esperando " });
    expect(state.etiqueta).toBe("Cliente esperando");
    expect(hasFilters(state)).toBe(true);
    expect(listQuery(state).toString()).toBe("etiqueta=Cliente+esperando");
    expect(toTaskFilter(state).label).toBe("Cliente esperando");
    expect(readListState({ etiqueta: "x".repeat(41) }).etiqueta).toBeNull();
    expect(readListState({ etiqueta: "a\u0000b" }).etiqueta).toBeNull();
  });

  it("filtra por departamento (slug) e ignora o que não é slug", () => {
    const state = readListState({
      depto: "agentes-e-automacoes",
      prio: "high",
    });
    expect(state.depto).toBe("agentes-e-automacoes");
    expect(hasFilters(state)).toBe(true);
    expect(listQuery(state).toString()).toBe(
      "depto=agentes-e-automacoes&prio=high",
    );
    expect(toTaskFilter(state).department).toBe("agentes-e-automacoes");
    for (const wrong of [
      "Design",
      "a b",
      "x--y",
      "-x",
      "'; drop",
      "a".repeat(61),
    ]) {
      expect(readListState({ depto: wrong }).depto).toBeNull();
    }
  });
});

describe("visão de cada tela e visão padrão do departamento", () => {
  it("o Quadro guarda só filtros e raias; a Lista, o resto", () => {
    const state = readListState({
      resp: "eu",
      agrupar: "frente",
      ordem: "prazo",
      col: "titulo,prazo",
      raia: "responsavel",
    });
    expect(listQuery(stateFor("board", state)).toString()).toBe(
      "resp=eu&raia=responsavel",
    );
    expect(listQuery(stateFor("list", state)).toString()).toBe(
      "resp=eu&agrupar=frente&ordem=prazo&col=titulo%2Cprazo",
    );
  });

  it("sem padrão guardado, é só o filtro do departamento", () => {
    expect(departmentViewQuery("list", "design", null)).toBe("depto=design");
    expect(departmentViewQuery("board", "design", "")).toBe("depto=design");
  });

  it("o padrão guardado sempre leva o departamento e nunca a frente", () => {
    expect(
      departmentViewQuery(
        "list",
        "design",
        `frente=${ID}&depto=sistemas&prio=urgent,high&agrupar=responsavel&raia=frente`,
      ),
    ).toBe("depto=design&prio=urgent%2Chigh&agrupar=responsavel");
    expect(
      departmentViewQuery(
        "board",
        "design",
        "depto=design&raia=frente&ordem=prazo",
      ),
    ).toBe("depto=design&raia=frente");
  });
});

describe("ordem e grupos", () => {
  const a = task({ code: "HUB-3", priority: "low", due_date: "2026-10-20" });
  const b = task({
    code: "HUB-12",
    priority: "urgent",
    created_at: "2026-10-05T10:00:00.000Z",
  });
  const c = task({ code: "HUB-7", priority: "high", due_date: "2026-10-12" });

  it("ordena por prazo (sem prazo no fim), prioridade, recentes e código", () => {
    const codes = (list: TaskDto[]) => list.map((t) => t.code);
    expect(codes(sortTasks([a, b, c], "prazo"))).toEqual([
      "HUB-7",
      "HUB-3",
      "HUB-12",
    ]);
    expect(codes(sortTasks([a, b, c], "prioridade"))).toEqual([
      "HUB-12",
      "HUB-7",
      "HUB-3",
    ]);
    expect(codes(sortTasks([a, b, c], "recentes"))[0]).toBe("HUB-12");
    expect(codes(sortTasks([b, c, a], "codigo"))).toEqual([
      "HUB-3",
      "HUB-7",
      "HUB-12",
    ]);
    expect(sortTasks([a, b], "padrao")).toEqual([a, b]);
  });

  it("agrupa por frente, responsável e prioridade, com as concluídas no fim", () => {
    const done = task({
      code: "HUB-1",
      status: { id: "d", name: "Concluída", category: "done", color: "#0a0" },
    });
    const inW = task({
      code: "HUB-2",
      workstream: { id: W2, title: "Agenda" },
    });
    const mine = task({
      code: "HUB-4",
      assignee: { type: "agent", id: ID, name: "Kratos" },
    });
    const byFront = groupTasks([inW, mine, done], "frente", [
      { id: W2, title: "Agenda" },
    ]);
    expect(byFront.map((g) => [g.label, g.tasks.length, g.done])).toEqual([
      ["Agenda", 1, false],
      ["Sem frente", 1, false],
      ["Concluídas", 1, true],
    ]);
    expect(
      groupTasks([inW, mine], "responsavel", []).map((g) => g.label),
    ).toEqual(["Kratos", "Ninguém"]);
    expect(groupTasks([a, b, c], "prioridade", []).map((g) => g.label)).toEqual(
      ["Urgente", "Alta", "Baixa"],
    );
  });
});
