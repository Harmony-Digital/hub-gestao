import { MockLanguageModelV4 } from "ai/test";
import type { ModelFactory } from "./index";

type CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0];

/**
 * Modelo simulado, só no computador de quem programa (HUB_DEV_FAKE_LLM=on no .env.local
 * e nos testes de ponta a ponta): responde sem chamar provedor nenhum, para conferir as
 * telas de IA. Nunca é carregado em produção (o ramo que o importa some do build).
 *
 * - Texto livre: responde "ok" (o botão Testar conexão).
 * - Resposta estruturada: devolve o objeto JSON escrito no fim do pedido, completando com
 *   null os campos do esquema que faltarem. Sem JSON no fim, responde fora do formato, e
 *   a tela mostra a recusa.
 */
export const fakeModel: ModelFactory = (_provider, _key, model) =>
  new MockLanguageModelV4({
    provider: "simulado",
    modelId: model,
    doGenerate: async (options) => ({
      content: [
        {
          type: "text",
          text:
            options.responseFormat?.type === "json"
              ? objectFrom(options)
              : "ok",
        },
      ],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 200,
          noCache: 200,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 40, text: 40, reasoning: undefined },
      },
      warnings: [],
    }),
  });

function objectFrom(options: CallOptions): string {
  const user = options.prompt.filter((m) => m.role === "user").at(-1);
  const text =
    user?.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("") ?? "";
  const json = /\{[^{}]*\}\s*$/.exec(text)?.[0];
  if (!json) return "fora do formato";
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return "fora do formato";
  }
  const format = options.responseFormat;
  const properties =
    format?.type === "json" &&
    format.schema &&
    typeof format.schema === "object" &&
    "properties" in format.schema &&
    format.schema.properties
      ? Object.keys(format.schema.properties)
      : [];
  for (const key of properties) {
    if (!(key in value)) value[key] = null;
  }
  return JSON.stringify(value);
}
