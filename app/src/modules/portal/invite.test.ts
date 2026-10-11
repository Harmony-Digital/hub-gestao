import { describe, expect, it } from "vitest";
import { inviteMessage, projectsPhrase, welcomeMessage } from "./invite";

describe("textos do onboarding (OB-13)", () => {
  it("fala dos projetos do cliente sem listar demais", () => {
    expect(projectsPhrase([])).toBe("os seus projetos com a gente");
    expect(projectsPhrase(["Atendimento"])).toBe("o projeto Atendimento");
    expect(projectsPhrase(["A", "B"])).toBe("os projetos A e B");
    expect(projectsPhrase(["A", "B", "C"])).toBe("os projetos A, B e C");
    expect(projectsPhrase(["A", "B", "C", "D"])).toBe(
      "os projetos A, B, C e outros",
    );
  });

  it("o convite traz o primeiro nome, os projetos, o link e a validade", () => {
    const text = inviteMessage({
      contactName: "  Ana   Souza ",
      orgName: "Harmony Digital",
      projects: ["Atendimento com IA"],
      url: "https://hub.exemplo.com.br/portal/entrar/abc",
      until: "17/10",
    });
    expect(text.split("\n")[0]).toBe("Olá, Ana! Tudo bem?");
    expect(text).toContain(
      "Liberamos para você o portal da Harmony Digital. Por lá, você acompanha o projeto Atendimento com IA",
    );
    expect(text).toContain(
      "Ele vale uma vez, até 17/10:\nhttps://hub.exemplo.com.br/portal/entrar/abc",
    );
    expect(text).toContain("(LGPD)");
  });

  it("boas-vindas do canal", () => {
    expect(
      welcomeMessage({
        projectName: "Atendimento",
        orgName: "Harmony Digital",
      }),
    ).toMatch(
      /^Olá! Este é o canal do projeto Atendimento com a equipe da Harmony Digital\./,
    );
  });
});
