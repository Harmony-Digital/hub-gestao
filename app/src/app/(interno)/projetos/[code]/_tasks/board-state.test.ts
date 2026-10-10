import { describe, expect, it } from "vitest";
import type { StatusOption } from "@/modules/tasks/board";
import type { TaskDto } from "@/modules/tasks/schemas";
import {
  boardColumns,
  columnBeside,
  moveCard,
  needsNote,
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
    assignee: null,
    due: null,
    late: false,
    parent: null,
    done: false,
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

describe("mover cartão", () => {
  const cards = [card("A", "s1"), card("B", "s1"), card("C", "s2")];

  it("põe no topo da coluna de destino sem mexer nos outros", () => {
    expect(
      moveCard(cards, "B", "s2").map((c) => `${c.code}:${c.statusId}`),
    ).toEqual(["A:s1", "B:s2", "C:s2"]);
    expect(
      moveCard(cards, "C", "s3").map((c) => `${c.code}:${c.statusId}`),
    ).toEqual(["A:s1", "B:s1", "C:s3"]);
  });

  it("mesmo status ou cartão desconhecido não mudam nada", () => {
    expect(moveCard(cards, "A", "s1")).toBe(cards);
    expect(moveCard(cards, "Z", "s2")).toBe(cards);
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
