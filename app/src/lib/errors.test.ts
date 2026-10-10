import { describe, expect, it } from "vitest";
import { z } from "zod";
import { badRequest, screenMessage, toHubError, unprocessable } from "./errors";

describe("mensagens de erro nas telas", () => {
  it("troca o nome técnico do campo pelo nome em PT-BR", () => {
    const error = unprocessable(
      "O campo reason parece conter um segredo (chave da AWS). Remova o valor.",
      { field: "reason" },
    );
    expect(screenMessage(error)).toBe(
      "O campo motivo parece conter um segredo (chave da AWS). Remova o valor.",
    );
  });

  it("em erro de validação, mostra o primeiro problema", () => {
    const parsed = z.strictObject({ title: z.string().min(1) }).safeParse({
      title: "",
    });
    expect(parsed.success).toBe(false);
    const error = toHubError(parsed.error);
    expect(screenMessage(error)).toMatch(/^Confira o campo título: /);
  });

  it("sem campo conhecido, mantém a mensagem", () => {
    expect(screenMessage(badRequest("Nada para atualizar."))).toBe(
      "Nada para atualizar.",
    );
    expect(
      screenMessage(unprocessable("Outro texto.", { field: "desconhecido" })),
    ).toBe("Outro texto.");
  });
});
