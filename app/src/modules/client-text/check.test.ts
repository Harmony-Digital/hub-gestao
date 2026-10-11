import { describe, expect, it } from "vitest";
import {
  checkClientText,
  describeIssue,
  type ClientTextContext,
} from "./check";

const ctx: ClientTextContext = {
  taskPrefix: "HUB",
  agentNames: ["Kratos", "Codex (exemplo)", "Executor"],
  otherClients: ["Padaria São José", "Clínica Bem-Estar"],
};
const kinds = (text: string) =>
  checkClientText(text, ctx).map((i) => `${i.kind}:${i.term}`);

describe("verificação do texto para o cliente (RC-12)", () => {
  it("texto no tom Harmony passa sem alertas", () => {
    expect(
      kinds(
        "Nesta semana, você ganhou o atendimento automático no WhatsApp. A próxima entrega (M2) fica pronta em 23/10, e a equipe da Harmony Digital segue com a COVID-19 como exemplo de pergunta frequente.",
      ),
    ).toEqual([]);
  });

  it("acha código de tarefa, commit e pedido de código", () => {
    expect(kinds("Concluímos a HUB-57 no commit 3f9a2c1 (PR #12).")).toEqual([
      "task_code:HUB-57",
      "commit:3f9a2c1",
      "pull_request:PR #12",
    ]);
    // Data e número comum não são commit; palavra só com letras de a a f também não.
    expect(kinds("Em 20261010, o café e a fada.")).toEqual([]);
  });

  it("acha agente, ferramenta interna e valor", () => {
    expect(
      kinds(
        "O Kratos e o Codex organizaram tudo no github, com R$ 15.000 de orçamento e 200 dólares de IA.",
      ),
    ).toEqual([
      "money:R$ 15.000",
      "money:200 dólares",
      "agent:Kratos",
      "agent:Codex",
      "tool:GitHub",
    ]);
    // Nome de agente que é palavra comum só conta com a grafia do nome.
    expect(kinds("O executor do contrato confirmou.")).toEqual([]);
  });

  it("acha o nome de outro cliente, com ou sem maiúsculas", () => {
    expect(kinds("Fizemos igual ao da padaria são josé.")).toEqual([
      "other_client:Padaria São José",
    ]);
  });

  it("descreve o alerta em PT-BR", () => {
    expect(describeIssue({ kind: "task_code", term: "HUB-57" })).toBe(
      "código de tarefa HUB-57",
    );
  });
});
