import { describe, expect, it } from "vitest";
import { parseReplyForm, REPLY_MAX } from "./form";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("resposta da equipe no canal do cliente", () => {
  it("lê o projeto e o texto", () => {
    expect(
      parseReplyForm(form({ project: "VIT", body: " Combinado!\r\n " })),
    ).toEqual({ ok: true, value: { project: "VIT", body: "Combinado!" } });
  });

  it("recusa projeto inválido, texto vazio e longo demais", () => {
    expect(parseReplyForm(form({ project: "V", body: "x" }))).toMatchObject({
      ok: false,
    });
    expect(parseReplyForm(form({ project: "VIT", body: "" }))).toMatchObject({
      ok: false,
    });
    expect(
      parseReplyForm(form({ project: "VIT", body: "x".repeat(REPLY_MAX + 1) })),
    ).toMatchObject({ ok: false });
  });
});
