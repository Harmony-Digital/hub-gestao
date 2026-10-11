import { describe, expect, it } from "vitest";
import type { StatusOption } from "@/modules/tasks/board";
import type { TaskDto } from "@/modules/tasks/schemas";
import {
  boardColumns,
  boardLanes,
  columnBeside,
  columnCodes,
  laneOf,
  needsNote,
  placeCard,
  sortForBoard,
  toBoardCard,
  type BoardCard,
} from "./board-state";

const STATUSES: StatusOption[] = [
  { id: "s1", name: "A fazer", category: "todo", color: "#8E93A3" },
  { id: "s2", name: "Em andamento", category: "in_progress", color: "#3B6FB6" },
  { id: "s3", name: "Bloqueada", category: "blocked", color: "#C8463C" },
  { id: "s4", name: "Concluída", category: "done", color: "#2F8F5B" },
];

function task(over: Partial<TaskDto> = {}): TaskDto {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    code: "HUB-1",
    project_code: "EXE",
    title: "Tarefa",
    description_md: null,
    status: { id: "s1", name: "A fazer", category: "todo", color: "#8E93A3" },
    priority: "normal",
    assignee: null,
    workstream: null,
    parent_code: null,
    start_date: null,
    due_date: null,
    estimate_minutes: null,
    sort_key: 0,
    source: "hub",
    external_ref: null,
    done_evidence: null,
    blocked_reason: null,
    blocked_on: null,
    completed_at: null,
    completed_by: null,
    created_by: { type: "user", id: null, name: "Fábio" },
    version: 3,
    created_at: "2026-10-09T10:00:00Z",
    updated_at: "2026-10-09T10:00:00Z",
    archived_at: null,
    ...over,
  };
}

function card(code: string, statusId: string): BoardCard {
  return {
    code,
    title: code,
    statusId,
    version: 1,
    priority: "normal",
    workstream: null,
    workstreamId: null,
    assignee: null,
    assigneeKey: null,
    sortKey: 0,
    due: null,
    late: false,
    parent: null,
    done: false,
    waitingOn: [],
    href: `/x?tarefa=${code}`,
  };
}

describe("cartões do quadro", () => {
  it("leva o essencial e marca o prazo vencido só em tarefa aberta", () => {
    const aberta = toBoardCard(
      task({
        due_date: "2026-10-01",
        assignee: { type: "agent", id: null, name: "Kratos" },
        workstream: { id: "w", title: "Fluxo" },
        parent_code: "HUB-9",
      }),
      "2026-10-10",
      "/projetos/EXE/quadro?tarefa=HUB-1",
    );
    expect(aberta).toMatchObject({
      code: "HUB-1",
      statusId: "s1",
      version: 3,
      workstream: "Fluxo",
      assignee: { name: "Kratos", agent: true },
      late: true,
      parent: "HUB-9",
      done: false,
      href: "/projetos/EXE/quadro?tarefa=HUB-1",
    });
    const feita = toBoardCard(
      task({
        due_date: "2026-10-01",
        status: { id: "s4", name: "Concluída", category: "done", color: "" },
      }),
      "2026-10-10",
      "/x",
    );
    expect(feita.late).toBe(false);
    expect(feita.done).toBe(true);
    expect(aberta.waitingOn).toEqual([]);
    expect(
      toBoardCard(task(), "2026-10-10", "/x", ["HUB-2", "HUB-5"]).waitingOn,
    ).toEqual(["HUB-2", "HUB-5"]);
    // Concluída não espera mais nada, mesmo com a outra ainda aberta.
    expect(
      toBoardCard(
        task({
          status: { id: "s4", name: "Concluída", category: "done", color: "" },
        }),
        "2026-10-10",
        "/x",
        ["HUB-2"],
      ).waitingOn,
    ).toEqual([]);
    expect(
      toBoardCard(task({ due_date: "2026-10-10" }), "2026-10-10", "/x").late,
    ).toBe(false);
  });

  it("conta cada coluna; a de concluídas usa o total completo", () => {
    const tasks = [
      task(),
      task(),
      task({ status: { id: "s3", name: "", category: "blocked", color: "" } }),
    ];
    expect(
      boardColumns(STATUSES, tasks, 120).map((c) => [c.name, c.total]),
    ).toEqual([
      ["A fazer", 2],
      ["Em andamento", 0],
      ["Bloqueada", 1],
      ["Concluída", 120],
    ]);
  });

  it("pede texto só ao concluir ou bloquear", () => {
    expect(STATUSES.map(needsNote)).toEqual([false, false, true, true]);
  });
});

describe("mover e ordenar cartões", () => {
  const cards = [card("A", "s1"), card("B", "s1"), card("C", "s2")];
  const view = (list: BoardCard[]) =>
    sortForBoard(list).map((c) => `${c.code}:${c.statusId}`);

  it("solta antes de outro cartão ou no fim da coluna, renumerando o destino", () => {
    const before = placeCard(cards, "B", "s1", "A");
    expect(columnCodes(before, "s1")).toEqual(["B", "A"]);
    expect(before.find((c) => c.code === "B")?.sortKey).toBe(1024);
    expect(columnCodes(placeCard(cards, "A", "s2", null), "s2")).toEqual([
      "C",
      "A",
    ]);
    expect(columnCodes(placeCard(cards, "A", "s2", "C"), "s2")).toEqual([
      "A",
      "C",
    ]);
    expect(view(placeCard(cards, "C", "s3", null))).toContain("C:s3");
  });

  it("cartão desconhecido não muda nada; empate segue a ordem do servidor", () => {
    expect(placeCard(cards, "Z", "s2", null)).toBe(cards);
    expect(
      sortForBoard([card("X", "s1"), card("Y", "s1")]).map((c) => c.code),
    ).toEqual(["X", "Y"]);
  });

  it("raia pela frente ou pelo responsável", () => {
    const c = {
      ...card("D", "s1"),
      workstreamId: "w1",
      assigneeKey: "agent:k",
    };
    expect(laneOf(c, "frente")).toBe("w1");
    expect(laneOf(c, "responsavel")).toBe("agent:k");
    expect(laneOf(card("E", "s1"), "frente")).toBe("none");
  });

  it("mostra só raias com cartão, na ordem certa, e a vazia no fim", () => {
    const withLane = (code: string, over: Partial<BoardCard>): BoardCard => ({
      ...card(code, "s1"),
      ...over,
    });
    const cards = [
      withLane("A", { workstreamId: "w2", workstream: "Tráfego" }),
      withLane("B", {}),
      withLane("C", { workstreamId: "w1", workstream: "Site" }),
      withLane("D", { workstreamId: "w9", workstream: "Antiga" }),
      withLane("E", {
        assigneeKey: "agent:k",
        assignee: { name: "Concierge", agent: true },
      }),
      withLane("F", {
        assigneeKey: "user:u2",
        assignee: { name: "Bruna", agent: false },
      }),
      withLane("G", {
        assigneeKey: "user:u1",
        assignee: { name: "Ana", agent: false },
      }),
    ];
    // Frentes na ordem do projeto; a que não está na lista vai depois.
    expect(boardLanes(cards, "frente", ["w1", "w2", "w3"])).toEqual([
      { key: "w1", label: "Site" },
      { key: "w2", label: "Tráfego" },
      { key: "w9", label: "Antiga" },
      { key: "none", label: "Sem frente" },
    ]);
    // Pessoas por nome, depois agentes, e quem não tem responsável no fim.
    expect(boardLanes(cards, "responsavel", [])).toEqual([
      { key: "user:u1", label: "Ana" },
      { key: "user:u2", label: "Bruna" },
      { key: "agent:k", label: "Concierge" },
      { key: "none", label: "Ninguém" },
    ]);
    expect(boardLanes([], "frente", ["w1"])).toEqual([]);
  });
});

describe("teclado no quadro", () => {
  const columns = [
    { id: "s2", left: 300, width: 280 },
    { id: "s1", left: 0, width: 280 },
    { id: "s3", left: 600, width: 280 },
  ];

  it("anda uma coluna para cada lado, na ordem da tela", () => {
    expect(columnBeside(columns, 140, 1)?.id).toBe("s2");
    expect(columnBeside(columns, 440, 1)?.id).toBe("s3");
    expect(columnBeside(columns, 440, -1)?.id).toBe("s1");
    expect(columnBeside(columns, 740, 1)).toBeNull();
    expect(columnBeside(columns, 140, -1)).toBeNull();
  });

  it("entre colunas, parte da mais próxima", () => {
    expect(columnBeside(columns, 290, 1)?.id).toBe("s2");
    expect(columnBeside([], 0, 1)).toBeNull();
  });
});
