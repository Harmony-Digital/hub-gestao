/**
 * Leitura dos formulários das chaves de IA (puro: tela e testes). A chave passa por aqui
 * só para ir ao núcleo, que cifra antes de gravar; ela nunca volta para a tela.
 */

import { LLM_PROVIDERS, type LlmProvider } from "@/modules/llm/providers";

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELOAD = "Pedido inválido. Recarregue a página.";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function apiKey(value: string): Parsed<string> {
  const key = value.trim();
  if (!key) return { ok: false, message: "Cole a chave do provedor." };
  if (/\s/.test(key)) {
    return {
      ok: false,
      message: "A chave não tem espaços nem quebras de linha.",
    };
  }
  return { ok: true, value: key };
}

export function parseNewAiKeyForm(form: FormData): Parsed<{
  provider: LlmProvider;
  label: string;
  key: string;
}> {
  const provider = text(form, "provider");
  if (!(LLM_PROVIDERS as readonly string[]).includes(provider)) {
    return { ok: false, message: "Escolha o provedor." };
  }
  const label = text(form, "label").trim();
  if (!label || label.length > 80 || /[\r\n]/.test(label)) {
    return {
      ok: false,
      message: "Dê um nome à chave, numa linha, com até 80 caracteres.",
    };
  }
  const key = apiKey(text(form, "key"));
  if (!key.ok) return key;
  return {
    ok: true,
    value: { provider: provider as LlmProvider, label, key: key.value },
  };
}

export function parseRotateAiKeyForm(
  form: FormData,
): Parsed<{ id: string; key: string }> {
  const id = text(form, "id");
  if (!UUID.test(id)) return { ok: false, message: RELOAD };
  const key = apiKey(text(form, "key"));
  if (!key.ok) return key;
  return { ok: true, value: { id, key: key.value } };
}

export function parseRevokeAiKeyForm(form: FormData): Parsed<{ id: string }> {
  const id = text(form, "id");
  return UUID.test(id)
    ? { ok: true, value: { id } }
    : { ok: false, message: RELOAD };
}
