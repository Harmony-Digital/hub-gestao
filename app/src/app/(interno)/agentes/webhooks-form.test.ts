import { describe, expect, it } from "vitest";
import { parseNewWebhookForm, parseWebhookIdForm } from "./webhooks-form";

function form(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("formulários dos webhooks", () => {
  it("cadastro: endereço https e os eventos marcados, na ordem do Hub", () => {
    expect(
      parseNewWebhookForm(
        form([
          ["url", "  https://hermes.exemplo.com.br/hub "],
          ["event", "agent.budget_exceeded"],
          ["event", "approval.requested"],
          ["event", "evento.inventado"],
        ]),
      ),
    ).toEqual({
      ok: true,
      value: {
        url: "https://hermes.exemplo.com.br/hub",
        events: ["approval.requested", "agent.budget_exceeded"],
      },
    });
    expect(
      parseNewWebhookForm(
        form([
          ["url", "http://hermes.exemplo.com.br/hub"],
          ["event", "task.created"],
        ]),
      ),
    ).toEqual({
      ok: false,
      message: "Use um endereço que comece com https://.",
    });
    expect(
      parseNewWebhookForm(form([["url", "https://hermes.exemplo.com.br/hub"]])),
    ).toEqual({ ok: false, message: "Marque pelo menos um evento." });
  });

  it("ações: id válido e a intenção", () => {
    const id = "0b7c6f1e-6f6a-4f0e-9a51-2f7d4c1b8a90";
    expect(
      parseWebhookIdForm(
        form([
          ["id", id],
          ["intent", "testar"],
        ]),
      ),
    ).toEqual({ ok: true, value: { id, intent: "testar" } });
    expect(parseWebhookIdForm(form([["id", "x"]])).ok).toBe(false);
  });
});
