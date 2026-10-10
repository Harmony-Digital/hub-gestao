import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PlanDto } from "@/modules/projects/schemas";
import { renderPlanMarkdown } from "@/modules/projects/service";
import { parsePlanFile } from "./plan-file";
import { matchStructure, normalizeTitle, pullIntoFile } from "./plan-merge";

// Plano do Hub de exemplo, com só o que a sincronização usa preenchido de verdade.
type Milestone = PlanDto["milestones"][number];
type Workstream = Milestone["workstreams"][number];
type Task = Workstream["tasks"][number];

const NOW = "2026-10-10T12:00:00.000Z";

function task(
  code: string,
  title: string,
  done = false,
  subtasks: Task["subtasks"] = [],
): Task {
  return {
    code,
    project_code: "EXE",
    title,
    status_name: done ? "Concluída" : "A fazer",
    status_category: done ? "done" : "todo",
    priority: "normal",
    assignee: null,
    due_date: null,
    blocked_reason: null,
    blocked_on: null,
    parent_code: null,
    subtasks,
  };
}

function sub(code: string, title: string, parent: string, done = false) {
  const { subtasks, ...rest } = task(code, title, done);
  void subtasks;
  return { ...rest, parent_code: parent };
}

function workstream(
  title: string,
  tasks: Task[],
  milestone: { id: string; code: string } | null,
): Workstream {
  return {
    id: randomUUID(),
    project_code: "EXE",
    milestone,
    department: null,
    title,
    title_client: null,
    description_internal: null,
    description_client: null,
    visibility: "internal",
    status: "planned",
    sort_order: 0,
    assignee: null,
    progress_pct: 0,
    task_count: tasks.length,
    done_count: 0,
    blocked_count: 0,
    updated_at: NOW,
    tasks,
  };
}

function milestone(
  code: string,
  title: string,
  build: (ref: { id: string; code: string }) => Workstream[],
  extra: Partial<Milestone> = {},
): Milestone {
  const ref = { id: randomUUID(), code };
  return {
    id: ref.id,
    project_code: "EXE",
    code,
    title,
    title_client: null,
    description_client: null,
    due_date: null,
    sort_order: Number(code.slice(1)),
    gate_required: true,
    status: "planned",
    late: false,
    visibility: "internal",
    acceptance_criteria: [],
    progress_pct: 0,
    task_count: 0,
    done_count: 0,
    delivered_at: null,
    accepted_at: null,
    accepted_by: null,
    client_received_at: null,
    client_received_by: null,
    workstreams: build(ref),
    ...extra,
  };
}

function plan(
  milestones: Milestone[],
  unplanned: PlanDto["unplanned"] = { workstreams: [], tasks: [] },
): PlanDto {
  return {
    project: {
      id: randomUUID(),
      code: "EXE",
      name: "Projeto de exemplo",
      client: { id: randomUUID(), slug: "exemplo", name: "Exemplo" },
      status: "active",
      phase: "validar",
      health: "healthy",
      progress_pct: 0,
      task_count: 0,
      open_task_count: 0,
      blocked_task_count: 0,
      start_date: null,
      target_date: null,
      repo_url: null,
      plan_path: "PLAN.md",
      updated_at: NOW,
    },
    milestones,
    unplanned,
  };
}

const pull = (text: string, hub: PlanDto) =>
  pullIntoFile(parsePlanFile(text), hub);

describe("correspondência", () => {
  it("acha marco pelo código ou pelo título e frente pelo título no marco", () => {
    const hub = plan([
      milestone("M1", "Fundação", (m) => [workstream("Banco", [], m)]),
      milestone("M2", "Preparação", (m) => [workstream("Banco", [], m)]),
    ]);
    const file = parsePlanFile(
      "## M1 — Outro nome\n### banco\n- [ ] a\n## ✅ Preparação\n### Banco\n- [ ] b\n## Sem par\n- [ ] c\n",
    );
    const match = matchStructure(file, hub);
    expect(match.milestones.map((m) => m?.code ?? null)).toEqual([
      "M1",
      "M2",
      null,
    ]);
    expect(match.workstreams.map((w) => w?.milestone?.code ?? null)).toEqual([
      "M1",
      "M2",
    ]);
    expect(normalizeTitle("  Ação **Rápida** ")).toBe("acao rapida");
  });
});

describe("pull", () => {
  it("o Hub vence nas caixas; código desconhecido fica como está", () => {
    const hub = plan([
      milestone("M1", "A", (m) => [
        workstream(
          "Frente",
          [task("HUB-1", "Um", true), task("HUB-2", "Dois")],
          m,
        ),
      ]),
    ]);
    const text =
      "## M1 — A\n### Frente\n- [ ] Um (HUB-1)\n- [x] Dois (HUB-2)\n- [x] Velha (HUB-99)\n";
    const out = pull(text, hub);
    expect(out.markdown).toBe(
      "## M1 — A\n### Frente\n- [x] Um (HUB-1)\n- [ ] Dois (HUB-2)\n- [x] Velha (HUB-99)\n",
    );
    expect(out).toMatchObject({ updated: 2, inserted: 0 });
  });

  it("insere o que só existe no Hub, no lugar certo", () => {
    const hub = plan(
      [
        milestone("M1", "A", (m) => [
          workstream(
            "Frente",
            [
              task("HUB-1", "Um", false, [sub("HUB-5", "Sub nova", "HUB-1")]),
              task("HUB-2", "Nova na frente"),
            ],
            m,
          ),
          workstream("Frente nova", [task("HUB-3", "Na frente nova")], m),
        ]),
        milestone("M2", "Marco novo", (m) => [
          workstream("Primeira", [task("HUB-4", "No marco novo", true)], m),
        ]),
      ],
      { workstreams: [], tasks: [task("HUB-6", "Sem frente")] },
    );
    const text = [
      "# Plano",
      "",
      "## M1 — A",
      "### Frente",
      "- [ ] Um (HUB-1)",
      "",
      "### 🔒 GATE M1 (aprovação do Fábio)",
      "- [ ] Critério",
      "",
      "## Registro de Execução",
      "| Data | O quê |",
      "",
    ].join("\n");
    const out = pull(text, hub);
    expect(out.markdown).toBe(
      [
        "# Plano",
        "",
        "## M1 — A",
        "### Frente",
        "- [ ] Um (HUB-1)",
        "  - [ ] Sub nova (HUB-5)",
        "- [ ] Nova na frente (HUB-2)",
        "",
        "### Frente nova",
        "- [ ] Na frente nova (HUB-3)",
        "",
        "### 🔒 GATE M1 (aprovação do Fábio)",
        "- [ ] Critério",
        "",
        "## M2 — Marco novo",
        "",
        "### Primeira",
        "- [x] No marco novo (HUB-4)",
        "",
        "## Sem marco",
        "",
        "### Tarefas sem frente",
        "- [ ] Sem frente (HUB-6)",
        "",
        "## Registro de Execução",
        "| Data | O quê |",
        "",
      ].join("\n"),
    );
    expect(out.inserted).toBe(5);
    // De novo, nada muda: o pull é estável.
    expect(pull(out.markdown, hub).markdown).toBe(out.markdown);
  });

  it("arquivo sem marcos: o marco novo entra antes do registro de execução", () => {
    const hub = plan([
      milestone("M1", "Primeiro", (m) => [
        workstream("Frente", [task("HUB-1", "Um")], m),
      ]),
    ]);
    const out = pull(
      "# Plano\n\n## Regras\nTexto.\n\n## Registro de Execução\n| Data |\n",
      hub,
    );
    expect(out.markdown).toBe(
      "# Plano\n\n## Regras\nTexto.\n\n## M1 — Primeiro\n\n### Frente\n- [ ] Um (HUB-1)\n\n## Registro de Execução\n| Data |\n",
    );
  });

  it("frente com o nome do marco: os itens ficam direto embaixo do ##", () => {
    const hub = plan([
      milestone("M1", "Entrega de outubro", (m) => [
        workstream(
          "Entrega de outubro",
          [task("HUB-1", "Antiga", true), task("HUB-2", "Nova")],
          m,
        ),
      ]),
    ]);
    const out = pull(
      "## Entrega de outubro\n\n- [x] Antiga (HUB-1)\n\n## Outra coisa\nTexto.\n",
      hub,
    );
    expect(out.markdown).toBe(
      "## Entrega de outubro\n\n- [x] Antiga (HUB-1)\n- [ ] Nova (HUB-2)\n\n## Outra coisa\nTexto.\n",
    );
  });

  it("critérios do GATE seguem o marco: aceito marca todos", () => {
    const text =
      "## M1 — A\n### Frente\n- [ ] x\n### 🔒 GATE M1\n- [ ] Primeiro critério\n- [x] Segundo critério\n- [x] Fora do Hub\n";
    const open = plan([
      milestone("M1", "A", () => [], {
        acceptance_criteria: [
          { text: "Primeiro critério", done: true },
          { text: "Segundo critério", done: false },
        ],
      }),
    ]);
    expect(pull(text, open).markdown).toBe(
      "## M1 — A\n### Frente\n- [ ] x\n### 🔒 GATE M1\n- [x] Primeiro critério\n- [ ] Segundo critério\n- [x] Fora do Hub\n",
    );
    const accepted = plan([
      milestone("M1", "A", () => [], {
        status: "accepted",
        acceptance_criteria: [{ text: "Primeiro critério", done: false }],
      }),
    ]);
    expect(pull(text, accepted).markdown).toBe(
      "## M1 — A\n### Frente\n- [ ] x\n### 🔒 GATE M1\n- [x] Primeiro critério\n- [x] Segundo critério\n- [x] Fora do Hub\n",
    );
  });

  it("mantém \\r\\n e quebra a última linha antes de inserir", () => {
    const hub = plan([
      milestone("M1", "A", (m) => [
        workstream("F", [task("HUB-1", "Um"), task("HUB-2", "Dois")], m),
      ]),
    ]);
    expect(pull("## M1 — A\r\n### F\r\n- [ ] Um (HUB-1)", hub).markdown).toBe(
      "## M1 — A\r\n### F\r\n- [ ] Um (HUB-1)\r\n- [ ] Dois (HUB-2)\r\n",
    );
  });

  it("a exportação do Hub já está em dia: o pull não muda nada", () => {
    const hub = plan(
      [
        milestone("M1", "A", (m) => [
          workstream(
            "Frente",
            [task("HUB-1", "Um", true, [sub("HUB-2", "Sub", "HUB-1")])],
            m,
          ),
        ]),
      ],
      {
        workstreams: [workstream("Solta", [task("HUB-3", "Três")], null)],
        tasks: [task("HUB-4", "Quatro")],
      },
    );
    const exported = renderPlanMarkdown(hub);
    const out = pull(exported, hub);
    expect(out.markdown).toBe(exported);
    expect(out).toMatchObject({ updated: 0, inserted: 0 });
  });
});
