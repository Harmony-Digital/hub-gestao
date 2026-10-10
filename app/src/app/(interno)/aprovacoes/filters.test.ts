import { describe, expect, it } from "vitest";
import { applyFilters, filtersHref, parseFilters } from "./filters";

const items = [
  { id: "1", status: "pending", type: "replan", project_code: "EXE" },
  {
    id: "2",
    status: "pending",
    type: "client_visibility",
    project_code: "VIT",
  },
  {
    id: "3",
    status: "approved",
    type: "client_visibility",
    project_code: "EXE",
  },
  { id: "4", status: "adjust_requested", type: "replan", project_code: "EXE" },
  { id: "5", status: "cancelled", type: "custom", project_code: null },
];

describe("filtros das aprovações", () => {
  it("lê o endereço com padrão em pendentes e ignora valores estranhos", () => {
    expect(parseFilters({})).toEqual({
      status: "pendentes",
      type: null,
      project: null,
    });
    expect(
      parseFilters({ status: "historico", tipo: "replan", projeto: "EXE" }),
    ).toEqual({ status: "historico", type: "replan", project: "EXE" });
    expect(
      parseFilters({ status: "x", tipo: "constructor", projeto: "exe" }),
    ).toEqual({ status: "pendentes", type: null, project: null });
  });

  it("monta o endereço só com o que não é padrão", () => {
    expect(
      filtersHref({ status: "pendentes", type: null, project: null }),
    ).toBe("/aprovacoes");
    expect(
      filtersHref({ status: "todas", type: "replan", project: "EXE" }),
    ).toBe("/aprovacoes?status=todas&tipo=replan&projeto=EXE");
  });

  it("filtra por situação, tipo e projeto e conta para os botões", () => {
    const pending = applyFilters(items, parseFilters({}));
    expect(pending.visible.map((a) => a.id)).toEqual(["1", "2"]);
    expect(pending.counts).toEqual({ pendentes: 2, historico: 3, todas: 5 });
    expect(pending.types).toEqual(["replan", "client_visibility"]);
    expect(pending.projects).toEqual(["EXE", "VIT"]);

    const history = applyFilters(
      items,
      parseFilters({ status: "historico", projeto: "EXE" }),
    );
    expect(history.visible.map((a) => a.id)).toEqual(["3", "4"]);
    expect(history.counts).toEqual({ pendentes: 1, historico: 2, todas: 3 });
    expect(history.types).toEqual(["client_visibility", "replan"]);
    expect(history.projects).toEqual(["EXE"]);

    const replans = applyFilters(
      items,
      parseFilters({ status: "todas", tipo: "replan" }),
    );
    expect(replans.visible.map((a) => a.id)).toEqual(["1", "4"]);
  });
});
