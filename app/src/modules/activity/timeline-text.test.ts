import { describe, expect, it } from "vitest";
import { describeEntityEvent } from "./timeline-text";

describe("frases do histórico das entidades (RF-43)", () => {
  it("criar, arquivar e restaurar dizem o que é", () => {
    expect(describeEntityEvent("milestone.created", {}).text).toBe(
      "criou o marco",
    );
    expect(describeEntityEvent("workstream.archived", {}).text).toBe(
      "arquivou a frente",
    );
    expect(describeEntityEvent("client.restored", {}).text).toBe(
      "restaurou o cliente",
    );
  });

  it("a edição lista o que mudou, em ordem fixa e com os valores que cabem", () => {
    expect(
      describeEntityEvent("milestone.updated", {
        gate_required: false,
        due_date: "2026-11-30",
        status: "delivered",
        title: "Novo",
      }).text,
    ).toBe(
      "mudou o título, mudou o status para Entregue, mudou a data para 30/11/2026 e tirou o GATE",
    );
    expect(
      describeEntityEvent("workstream.updated", { status: "blocked" }).text,
    ).toBe("mudou o status para Bloqueada");
    expect(describeEntityEvent("client.updated", { name: "X" }).text).toBe(
      "mudou o nome",
    );
    expect(
      describeEntityEvent("project.updated", { desconhecido: 1 }).text,
    ).toBe("atualizou o projeto");
  });

  it("pedidos de aprovação, saúde, logo e visibilidade", () => {
    expect(
      describeEntityEvent("approval.requested", {
        type: "milestone_acceptance",
        title: "Aceite do M2",
      }),
    ).toEqual({
      text: "pediu uma aprovação (Aceite de marco)",
      detail: "Aceite do M2",
    });
    expect(
      describeEntityEvent("approval.decided", {
        status: "adjust_requested",
        note: "Falta o teste.",
      }),
    ).toEqual({ text: "pediu ajuste no pedido", detail: "Falta o teste." });
    expect(
      describeEntityEvent("project.health_changed", {
        health: "at_risk",
        reasons: ["1 marco passou da data sem entrega."],
      }),
    ).toEqual({
      text: "a saúde passou a Em risco",
      detail: "1 marco passou da data sem entrega.",
    });
    expect(describeEntityEvent("client.logo_changed", {}).text).toBe(
      "trocou o logo",
    );
    expect(
      describeEntityEvent("workstream.visibility_changed", {
        visibility: "client",
      }).text,
    ).toBe("passou a mostrar a frente ao cliente");
    expect(describeEntityEvent("algo.estranho", null).text).toBe(
      "algo.estranho",
    );
  });
});
