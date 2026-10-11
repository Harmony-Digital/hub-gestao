import { CLIENT_WRITER } from "./client-writer";
import { CONCIERGE_INTERPRET } from "./concierge";
import { CONNECTION_TEST } from "./connection-test";
import { PLANNER_PROPOSE } from "./planner";

/**
 * Prompts dos agentes internos do Hub (D5), versionados. Cada prompt tem um código
 * estável (o papel do catálogo AGENTES.md ou HUB, e o uso), a versão e o texto das
 * instruções. Mudou o texto: suba a versão e registre a mudança no CHANGELOG.md desta
 * pasta, com a impressão digital nova; o teste da pasta falha se o texto mudar sem isso.
 * O código e a versão vão no propósito de cada chamada (agent_runs), para saber qual
 * prompt gerou cada resposta.
 */
export type PromptSpec = {
  /** Código estável, como "CO-10/interpretar". */
  id: string;
  version: number;
  instructions: string;
};

/** "CO-10/interpretar@1": entra no propósito registrado de cada chamada. */
export const promptTag = (prompt: PromptSpec): string =>
  `${prompt.id}@${prompt.version}`;

/** Todos os prompts em uso, para o teste do histórico. */
export const PROMPTS: readonly PromptSpec[] = [
  CONNECTION_TEST,
  CONCIERGE_INTERPRET,
  PLANNER_PROPOSE,
  CLIENT_WRITER,
];
