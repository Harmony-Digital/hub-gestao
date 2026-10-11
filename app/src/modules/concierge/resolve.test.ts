import { describe, expect, it } from "vitest";
import { conciergeMessage, weekdayOf, type ConciergeContext } from "./context";
import {
  isoDate,
  matchMember,
  matchProject,
  memberValue,
  screenTarget,
  taskCode,
} from "./resolve";

const ME = "11111111-1111-4111-8111-111111111111";
const CTX: ConciergeContext = {
  today: "2026-10-10",
  screenProject: null,
  me: { id: ME, name: "Fábio Almeida" },
  projects: [
    { id: "p1", code: "LOJ", name: "Loja Virtual", client: "Comércio Modelo" },
    {
      id: "p2",
      code: "JRN",
      name: "Radar de Notícias",
      client: "Editora Água Doce",
    },
    { id: "p3", code: "SIT", name: "Site Harmony", client: "Harmony" },
  ],
  team: [
    { type: "user", id: ME, name: "Fábio Almeida" },
    { type: "user", id: "u2", name: "Márcia Lima" },
    { type: "agent", id: "a1", name: "Kratos" },
    { type: "agent", id: "a2", name: "Claude Code do Fábio" },
  ],
  approvals: [
    {
      ref: 1,
      id: "ap1",
      typeLabel: "Relatório de status",
      title: "Status semanal\ndo Radar",
      project: "JRN",
    },
  ],
};

describe("conferência do Concierge", () => {
  it("acha o projeto pelo código, pelo nome ou pelo cliente, sem adivinhar", () => {
    expect(matchProject("loj", CTX)?.code).toBe("LOJ");
    expect(matchProject("Radar de Notícias", CTX)?.code).toBe("JRN");
    expect(matchProject("agua doce", CTX)?.code).toBe("JRN");
    // "harmony" bate em um só (o cliente do Site); "a" bate em vários: ambíguo.
    expect(matchProject("harmony", CTX)?.code).toBe("SIT");
    expect(matchProject("a", CTX)).toBeNull();
    expect(matchProject("Rodrigo", CTX)).toBeNull();
    expect(matchProject(null, CTX)).toBeNull();
  });

  it("acha a pessoa ou o agente pelo nome; eu é quem pede", () => {
    expect(matchMember("eu", CTX)).toEqual({
      type: "user",
      id: ME,
      name: "Fábio Almeida",
    });
    expect(matchMember("marcia", CTX)?.id).toBe("u2");
    expect(matchMember("KRATOS", CTX)?.id).toBe("a1");
    expect(matchMember("claude code", CTX)?.id).toBe("a2");
    // "fabio" está em dois nomes (a pessoa e o agente): ambíguo pelo trecho, mas o
    // primeiro nome exato decide.
    expect(matchMember("fabio", CTX)?.id).toBe(ME);
    expect(matchMember("Zé", CTX)).toBeNull();
    expect(memberValue(matchMember("eu", CTX), CTX)).toBe("me");
    expect(memberValue(matchMember("kratos", CTX), CTX)).toBe("agent:a1");
    expect(memberValue(null, CTX)).toBe("");
  });

  it("código de tarefa falado ou digitado de qualquer jeito", () => {
    expect(taskCode("HUB-12")).toBe("HUB-12");
    expect(taskCode("hub 12")).toBe("HUB-12");
    expect(taskCode("hub12")).toBe("HUB-12");
    expect(taskCode(" Hub-007 ")).toBe("HUB-7");
    expect(taskCode("tarefa doze")).toBeNull();
    expect(taskCode(null)).toBeNull();
  });

  it("data só se for real", () => {
    expect(isoDate("2026-10-16")).toBe("2026-10-16");
    expect(isoDate("2026-02-30")).toBeNull();
    expect(isoDate("16/10/2026")).toBeNull();
    expect(isoDate(null)).toBeNull();
  });

  it("telas: as gerais e as de projeto (só com projeto conhecido)", () => {
    expect(screenTarget("aprovacoes", null)).toEqual({
      href: "/aprovacoes",
      label: "Aprovações",
    });
    expect(screenTarget("sala_de_controle", null)?.href).toBe("/agentes");
    expect(screenTarget("lista", CTX.projects[0])).toEqual({
      href: "/projetos/LOJ/lista",
      label: "Lista de LOJ · Loja Virtual",
    });
    expect(screenTarget("quadro", null)).toBeNull();
    // Sem tela dita, mas com projeto: a Visão geral do projeto.
    expect(screenTarget(null, CTX.projects[1])?.href).toBe("/projetos/JRN");
    expect(screenTarget(null, null)).toBeNull();
  });

  it("a mensagem leva o dia, a tela, o alcance e o pedido por último", () => {
    expect(weekdayOf("2026-10-10")).toBe("sábado");
    expect(weekdayOf("2026-10-16")).toBe("sexta-feira");
    const message = conciergeMessage(
      { ...CTX, screenProject: "LOJ" },
      "  cria uma tarefa  ",
    );
    expect(message.split("\n")).toEqual([
      "HOJE: sábado, 2026-10-10",
      "PROJETO DA TELA: LOJ (Loja Virtual)",
      "QUEM PEDE: Fábio Almeida",
      "PROJETOS (código · nome · cliente):",
      "- LOJ · Loja Virtual · Comércio Modelo",
      "- JRN · Radar de Notícias · Editora Água Doce",
      "- SIT · Site Harmony · Harmony",
      "EQUIPE (nome · pessoa ou agente):",
      "- Fábio Almeida · pessoa",
      "- Márcia Lima · pessoa",
      "- Kratos · agente",
      "- Claude Code do Fábio · agente",
      "PEDIDOS DE APROVAÇÃO (número · tipo · título · projeto):",
      "1 · Relatório de status · Status semanal do Radar · JRN",
      "PEDIDO:",
      "cria uma tarefa",
    ]);
  });
});
