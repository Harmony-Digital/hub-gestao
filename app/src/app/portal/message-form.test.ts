import { describe, expect, it } from "vitest";
import { MESSAGE_MAX, parseMessageForm } from "./message-form";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("mensagem do portal para a equipe", () => {
  it("lê o projeto e o texto, com as quebras de linha normalizadas", () => {
    expect(
      parseMessageForm(form({ project: "EXE", body: "  Oi,\r\ntudo bem?  " })),
    ).toEqual({ ok: true, value: { project: "EXE", body: "Oi,\ntudo bem?" } });
  });

  it("recusa projeto inválido, texto vazio e texto longo demais", () => {
    expect(
      parseMessageForm(form({ project: "exe", body: "Oi" })),
    ).toMatchObject({ ok: false });
    expect(parseMessageForm(form({ project: "EXE", body: "   " }))).toEqual({
      ok: false,
      message: "Escreva a mensagem antes de enviar.",
    });
    expect(
      parseMessageForm(
        form({ project: "EXE", body: "a".repeat(MESSAGE_MAX + 1) }),
      ),
    ).toMatchObject({ ok: false });
  });
});
