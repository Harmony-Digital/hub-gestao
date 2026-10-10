/** Provedores de IA do Hub (decisão D5). Puro: vale na tela, no servidor e nos testes. */

export const LLM_PROVIDERS = ["anthropic", "openai", "xai"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  xai: "xAI (Grok)",
};
