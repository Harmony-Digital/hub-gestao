import { describe, expect, it } from "vitest";
import {
  businessDaysBetween,
  computeHealth,
  driftForecast,
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

describe("deriva prevista (PRD §5.7)", () => {
  const forecast = (
    done_recent: number,
    upcoming: { code: string; slack_days: number; remaining: number }[],
  ) => ({ done_recent, upcoming });

  it("compara o tempo que falta, no ritmo das últimas 2 semanas, com a folga", () => {
    // 7 concluídas em 14 dias: meia tarefa por dia; 10 abertas precisam de 20 dias.
    expect(
      driftForecast(
        forecast(7, [
          { code: "M2", slack_days: 15, remaining: 10 },
          { code: "M3", slack_days: 40, remaining: 10 },
        ]),
      ),
    ).toEqual([{ code: "M2", slack_days: 15, remaining: 10, needed_days: 20 }]);
    // Cabe na folga, ou não tem tarefa aberta: nada.
    expect(
      driftForecast(
        forecast(14, [
          { code: "M2", slack_days: 10, remaining: 10 },
          { code: "M3", slack_days: 0, remaining: 0 },
        ]),
      ),
    ).toEqual([]);
  });

  it("sem nada concluído, só acusa o marco que vence dentro das 2 semanas", () => {
    expect(
      driftForecast(
        forecast(0, [
          { code: "M1", slack_days: 5, remaining: 3 },
          { code: "M2", slack_days: 30, remaining: 8 },
        ]),
      ),
    ).toEqual([{ code: "M1", slack_days: 5, remaining: 3, needed_days: null }]);
  });

  it("vira amarelo, com a frase, a ação e os outros marcos", () => {
    const result = computeHealth(
      {
        ...base,
        forecast: forecast(7, [
          { code: "M2", slack_days: 15, remaining: 10 },
          { code: "M3", slack_days: 20, remaining: 30 },
        ]),
      },
      now,
    );
    expect(result.health).toBe("attention");
    expect(result.signals).toEqual([
      {
        kind: "drift_forecast",
        text: "No ritmo das últimas 2 semanas, o M2 precisa de cerca de 20 dias e vence em 15 dias. Outro marco também.",
      },
    ]);
    expect(riskAction("drift_forecast", "VIT")).toEqual({
      label: "Reveja o escopo ou a data do marco, ou reforce as frentes dele.",
      href: "/projetos/VIT",
    });
    expect(
      computeHealth(
        {
          ...base,
          forecast: forecast(0, [{ code: "M1", slack_days: 0, remaining: 1 }]),
        },
        now,
      ).reasons,
    ).toEqual([
      "O M1 vence hoje com 1 tarefa aberta, e nada foi concluído nas últimas 2 semanas.",
    ]);
    // Vermelho continua na frente.
    expect(
      computeHealth(
        {
          ...base,
          late_milestones: 1,
          forecast: forecast(0, [{ code: "M2", slack_days: 3, remaining: 2 }]),
        },
        now,
      ).signals.map((s) => s.kind),
    ).toEqual(["late_milestones", "drift_forecast"]);
  });
});
