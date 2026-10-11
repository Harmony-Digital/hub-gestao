import { describe, expect, it } from "vitest";
import {
  businessDaysBetween,
  computeHealth,
  riskAction,
  risksFrom,
} from "./rule";

const base = {
  open_task_count: 20,
  blocked_task_count: 0,
  late_milestones: 0,
  broken_dependencies: 0,
  oldest_pending_approval_at: null,
};
const now = new Date("2026-10-09T12:00:00Z"); // sexta-feira

describe("saúde do projeto (PRD §5.7)", () => {
  it("verde sem sinais", () => {
    expect(computeHealth(base, now)).toEqual({
      health: "healthy",
      reasons: [],
      signals: [],
    });
  });

  it("vermelho com dependência quebrada entre frentes", () => {
    const one = computeHealth({ ...base, broken_dependencies: 1 }, now);
    expect(one.health).toBe("at_risk");
    expect(one.reasons).toEqual([
      "1 frente começou antes de terminar a frente de que depende.",
    ]);
    expect(
      computeHealth({ ...base, broken_dependencies: 2 }, now).reasons,
    ).toEqual([
      "2 frentes começaram antes de terminar as frentes de que dependem.",
    ]);
  });

  it("vermelho com marco atrasado", () => {
    const r = computeHealth({ ...base, late_milestones: 2 }, now);
    expect(r.health).toBe("at_risk");
    expect(r.reasons[0]).toMatch(/2 marcos/);
  });

  it("bloqueios: 10% a 25% é amarelo, acima de 25% é vermelho", () => {
    expect(computeHealth({ ...base, blocked_task_count: 1 }, now).health).toBe(
      "healthy",
    );
    expect(computeHealth({ ...base, blocked_task_count: 2 }, now).health).toBe(
      "attention",
    );
    expect(computeHealth({ ...base, blocked_task_count: 5 }, now).health).toBe(
      "attention",
    );
    expect(computeHealth({ ...base, blocked_task_count: 6 }, now).health).toBe(
      "at_risk",
    );
  });

  it("aprovação parada há mais de 3 dias úteis é amarelo", () => {
    expect(
      computeHealth(
        { ...base, oldest_pending_approval_at: "2026-10-06T12:00:00Z" },
        now,
      ).health,
    ).toBe("healthy");
    const r = computeHealth(
      { ...base, oldest_pending_approval_at: "2026-10-02T12:00:00Z" },
      now,
    );
    expect(r.health).toBe("attention");
    expect(r.reasons[0]).toMatch(/5 dias úteis/);
  });

  it("projeto sem tarefas não divide por zero", () => {
    expect(computeHealth({ ...base, open_task_count: 0 }, now).health).toBe(
      "healthy",
    );
  });

  it("conta só dias úteis", () => {
    expect(
      businessDaysBetween(
        new Date("2026-10-09T10:00:00Z"),
        new Date("2026-10-12T10:00:00Z"),
      ),
    ).toBe(1);
    expect(
      businessDaysBetween(
        new Date("2026-10-05T10:00:00Z"),
        new Date("2026-10-09T10:00:00Z"),
      ),
    ).toBe(4);
  });
});

describe("riscos com ação sugerida (RF-24)", () => {
  it("cada sinal tem o tipo, e as frases seguem as mesmas", () => {
    const r = computeHealth(
      {
        ...base,
        late_milestones: 1,
        blocked_task_count: 3,
        oldest_pending_approval_at: "2026-10-01T12:00:00Z",
      },
      now,
    );
    expect(r.signals.map((s) => s.kind)).toEqual([
      "late_milestones",
      "blocked_tasks",
      "stale_approval",
    ]);
    expect(r.reasons).toEqual(r.signals.map((s) => s.text));
  });

  it("a ação leva ao lugar de resolver", () => {
    expect(riskAction("late_milestones", "VIT").href).toBe("/projetos/VIT");
    expect(riskAction("blocked_tasks", "VIT").href).toBe(
      "/projetos/VIT/quadro",
    );
    expect(riskAction("stale_approval", "VIT")).toEqual({
      label: "Decida o pedido parado nas Aprovações.",
      href: "/aprovacoes?projeto=VIT",
    });
  });

  it("lê o gravado: com os sinais, a ação de cada um; só com as frases, o projeto", () => {
    const signals = computeHealth({ ...base, broken_dependencies: 1 }, now);
    expect(
      risksFrom({ reasons: signals.reasons, signals: signals.signals }, "VIT"),
    ).toEqual([
      {
        text: "1 frente começou antes de terminar a frente de que depende.",
        action: riskAction("broken_dependencies", "VIT"),
      },
    ]);
    expect(risksFrom({ reasons: ["Motivo antigo."] }, "VIT")).toEqual([
      {
        text: "Motivo antigo.",
        action: { label: "Abrir o projeto.", href: "/projetos/VIT" },
      },
    ]);
    expect(
      risksFrom({ signals: [{ kind: "x", text: "Estranho." }, 7] }, "VIT"),
    ).toEqual([
      {
        text: "Estranho.",
        action: { label: "Abrir o projeto.", href: "/projetos/VIT" },
      },
    ]);
    expect(risksFrom(null, "VIT")).toEqual([]);
  });
});
