import type { PromptSpec } from "./index";

/** Chamada mínima do botão Testar conexão (Sala de Controle): gasta poucos tokens. */
export const CONNECTION_TEST: PromptSpec = {
  id: "HUB/testar-conexao",
  version: 1,
  instructions: "Responda apenas com a palavra ok.",
};
