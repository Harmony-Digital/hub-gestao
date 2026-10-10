import { describe, expect, it } from "vitest";
import { splitLinks } from "./links";

describe("links no texto livre", () => {
  it("separa endereços e tira a pontuação do fim da frase", () => {
    expect(
      splitLinks(
        "Entregue em https://exemplo.com/a?b=1. Ver também (https://x.io/y).",
      ),
    ).toEqual([
      { type: "text", value: "Entregue em " },
      { type: "link", href: "https://exemplo.com/a?b=1" },
      { type: "text", value: ". Ver também (" },
      { type: "link", href: "https://x.io/y" },
      { type: "text", value: ")." },
    ]);
  });

  it("não transforma outros esquemas em link", () => {
    expect(
      splitLinks("javascript:alert(1) data:text/html,x ftp://a.b"),
    ).toEqual([
      { type: "text", value: "javascript:alert(1) data:text/html,x ftp://a.b" },
    ]);
  });

  it("texto sem endereço fica inteiro; endereço vazio é ignorado", () => {
    expect(splitLinks("só texto")).toEqual([
      { type: "text", value: "só texto" },
    ]);
    expect(splitLinks("veja https://.")).toEqual([
      { type: "text", value: "veja https://." },
    ]);
    expect(splitLinks("")).toEqual([]);
  });
});
