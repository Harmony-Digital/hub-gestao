/**
 * Leitura do formulário do modelo de IA do agente (puro: tela e testes). Quem decide o que
 * vale continua sendo o núcleo (modules/llm/agent-model).
 */

import { LLM_PROVIDERS, type LlmProvider } from "@/modules/llm/providers";
import { parseBudget } from "./form";

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRICE = /^\d{1,4}([.,]\d{1,4})?$/;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function price(raw: string, label: string): Parsed<number> {
  if (!raw) return { ok: false, message: `Informe o preço de ${label}.` };
  const value = PRICE.test(raw) ? Number(raw.replace(",", ".")) : NaN;
  if (!Number.isFinite(value) || value > 1000) {
    return {
      ok: false,
      message: `Preço de ${label} em dólares por milhão de tokens, de 0 a 1.000 (ex.: 3 ou 0,15).`,
    };
  }
  return { ok: true, value };
}

export type AgentModelForm =
  | { agentId: string; input: { off: true } }
  | {
      agentId: string;
      input: {
        provider: LlmProvider;
        model: string;
        credential_id: string;
        price_in: number;
        price_out: number;
        budget_usd_month: number;
      };
    };

export function parseAgentModelForm(form: FormData): Parsed<AgentModelForm> {
  const agentId = text(form, "agent_id");
  if (!UUID.test(agentId)) {
    return { ok: false, message: "Pedido inválido. Recarregue a página." };
  }
  if (text(form, "intent") === "off") {
    return { ok: true, value: { agentId, input: { off: true } } };
  }
  const provider = text(form, "provider");
  if (!(LLM_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, message: "Escolha o provedor." };
  }
  const credentialId = text(form, "credential_id");
  if (!UUID.test(credentialId)) {
    return { ok: false, message: "Escolha a chave do provedor." };
  }
  const model = text(form, "model");
  if (!model) return { ok: false, message: "Informe o modelo." };
  if (model.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(model)) {
    return {
      ok: false,
      message: "O nome do modelo vai sem espaços, com até 120 caracteres.",
    };
  }
  const priceIn = price(text(form, "price_in"), "entrada");
  if (!priceIn.ok) return priceIn;
  const priceOut = price(text(form, "price_out"), "saída");
  if (!priceOut.ok) return priceOut;
  const budget = parseBudget(text(form, "budget"));
  if (!budget.ok) return budget;
  if (budget.value <= 0) {
    return {
      ok: false,
      message: "Defina o teto do mês: sem teto, o agente não usa IA.",
    };
  }
  return {
    ok: true,
    value: {
      agentId,
      input: {
        provider: provider as LlmProvider,
        model,
        credential_id: credentialId,
        price_in: priceIn.value,
        price_out: priceOut.value,
        budget_usd_month: budget.value,
      },
    },
  };
}
