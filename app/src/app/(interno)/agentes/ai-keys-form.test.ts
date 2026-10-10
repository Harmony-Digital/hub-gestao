import { describe, expect, it } from "vitest";
import {
  parseNewAiKeyForm,
  parseRevokeAiKeyForm,
  parseRotateAiKeyForm,
} from "./ai-keys-form";

const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

describe("formulários das chaves de IA", () => {
  it("nova chave: provedor, nome e chave sem espaços", () => {
    expect(
      parseNewAiKeyForm(
        form({ provider: "openai", label: " OpenAI ", key: " sk-abc " }),
      ),
    ).toEqual({
      ok: true,
      value: { provider: "openai", label: "OpenAI", key: "sk-abc" },
    });
    expect(
      parseNewAiKeyForm(form({ provider: "google", label: "x", key: "y" })),
    ).toMatchObject({ ok: false, message: "Escolha o provedor." });
    expect(
      parseNewAiKeyForm(form({ provider: "xai", label: "", key: "y" })),
    ).toMatchObject({ ok: false });
    expect(
      parseNewAiKeyForm(form({ provider: "xai", label: "Grok", key: "a b" })),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/espaços/) });
  });

  it("trocar e revogar pedem o id certo", () => {
    expect(parseRotateAiKeyForm(form({ id: ID, key: "sk-novo" }))).toEqual({
      ok: true,
      value: { id: ID, key: "sk-novo" },
    });
    expect(parseRotateAiKeyForm(form({ id: "x", key: "k" }))).toMatchObject({
      ok: false,
    });
    expect(parseRevokeAiKeyForm(form({ id: ID }))).toEqual({
      ok: true,
      value: { id: ID },
    });
  });
});
