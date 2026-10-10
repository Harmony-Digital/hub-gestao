import { describe, expect, it } from "vitest";
import { parseAgentModelForm } from "./agent-model-form";

const AGENT = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
const CRED = "5ed7832f-3bd9-474e-95dc-4c36bc281cce";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

const full = {
  agent_id: AGENT,
  intent: "save",
  provider: "anthropic",
  credential_id: CRED,
  model: "claude-modelo-x",
  price_in: "3",
  price_out: "0,15",
  budget: "12,50",
};

describe("formulário do modelo de IA", () => {
  it("lê tudo, com vírgula decimal", () => {
    expect(parseAgentModelForm(form(full))).toEqual({
      ok: true,
      value: {
        agentId: AGENT,
        input: {
          provider: "anthropic",
          model: "claude-modelo-x",
          credential_id: CRED,
          price_in: 3,
          price_out: 0.15,
          budget_usd_month: 12.5,
        },
      },
    });
  });

  it("desligar não pede o resto", () => {
    expect(
      parseAgentModelForm(form({ agent_id: AGENT, intent: "off" })),
    ).toEqual({ ok: true, value: { agentId: AGENT, input: { off: true } } });
  });

  it("recusa preço inválido, teto zero e modelo com espaço", () => {
    expect(
      parseAgentModelForm(form({ ...full, price_in: "três" })),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/entrada/) });
    expect(parseAgentModelForm(form({ ...full, budget: "" }))).toMatchObject({
      ok: false,
      message: expect.stringMatching(/teto/),
    });
    expect(
      parseAgentModelForm(form({ ...full, model: "claude modelo" })),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/espaços/) });
    expect(
      parseAgentModelForm(form({ ...full, provider: "google" })),
    ).toMatchObject({ ok: false });
  });
});
