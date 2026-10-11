/**
 * Verificação do texto para o cliente (RC-12, PRD §5.2 e AGENTES.md): antes de um texto
 * ir para o portal, o Hub procura o que nunca deve aparecer para o cliente: código de
 * tarefa, nome de agente, ferramenta interna, código de commit, pedido de código (PR),
 * valor em dinheiro e nome de outro cliente. É regra em código, sem IA: vale sempre,
 * inclusive sem chave de IA. O resultado são alertas para quem decide; a decisão continua
 * de uma pessoa. Puro: vale no servidor, na tela e nos testes.
 */

export type ClientTextIssueKind =
  | "task_code"
  | "agent"
  | "tool"
  | "commit"
  | "pull_request"
  | "money"
  | "other_client";

export type ClientTextIssue = { kind: ClientTextIssueKind; term: string };

export type ClientTextContext = {
  /** Prefixo dos códigos de tarefa do workspace (HUB, em HUB-12). */
  taskPrefix: string;
  /** Nomes dos agentes do workspace. */
  agentNames: string[];
  /** Nomes dos outros clientes (nunca o do próprio cliente nem o da Harmony). */
  otherClients: string[];
};

/** Ferramentas e serviços internos que o cliente não precisa ler (tom Harmony). */
export const INTERNAL_TOOLS = [
  "Kratos",
  "Hermes",
  "Claude",
  "Codex",
  "ChatGPT",
  "GPT",
  "Grok",
  "OpenAI",
  "Anthropic",
  "MCP",
  "Supabase",
  "GitHub",
  "Vercel",
  "n8n",
  "Playwright",
  "Traefik",
  "plan.md",
  "PLAN.md",
];

const LABEL: Record<ClientTextIssueKind, string> = {
  task_code: "código de tarefa",
  agent: "nome de agente",
  tool: "ferramenta interna",
  commit: "código de commit",
  pull_request: "pedido de código",
  money: "valor em dinheiro",
  other_client: "nome de outro cliente",
};

/** "código de tarefa HUB-12", para a tela. */
export function describeIssue(issue: ClientTextIssue): string {
  return `${LABEL[issue.kind]} ${issue.term}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A palavra (ou o nome) inteira, com acentos: "Kratos" não casa dentro de "Kratoss". */
function wordPattern(term: string, flags = "gu"): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escape(term)}(?![\\p{L}\\p{N}_])`,
    flags,
  );
}

/** "Codex (exemplo)" vira "Codex": o nome, sem a observação entre parênteses. */
function baseName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "").trim();
}

export function checkClientText(
  text: string,
  ctx: ClientTextContext,
): ClientTextIssue[] {
  const found = new Map<string, ClientTextIssue>();
  const add = (kind: ClientTextIssueKind, term: string) => {
    const key = `${kind}:${term.toLowerCase()}`;
    if (!found.has(key)) found.set(key, { kind, term });
  };

  if (ctx.taskPrefix) {
    for (const m of text.matchAll(
      new RegExp(`(?<![\\p{L}\\p{N}])${escape(ctx.taskPrefix)}-\\d+\\b`, "gu"),
    )) {
      add("task_code", m[0]);
    }
  }
  for (const m of text.matchAll(
    /(?<![\p{L}\p{N}])[0-9a-f]{7,40}(?![\p{L}\p{N}])/gu,
  )) {
    // Código de commit: hexadecimal com letra e número (não pega datas nem palavras).
    if (/[a-f]/.test(m[0]) && /\d/.test(m[0])) add("commit", m[0]);
  }
  for (const m of text.matchAll(/\b(?:PR|pull request)\s*#\s*\d+/gi)) {
    add("pull_request", m[0]);
  }
  for (const m of text.matchAll(
    /(?:R\$|US\$|€)\s?\d[\d.,]*|\d[\d.,]*\s?(?:reais|dólares)\b/giu,
  )) {
    add("money", m[0].trim());
  }

  const agents = new Set(
    ctx.agentNames.map(baseName).filter((n) => n.length >= 3),
  );
  for (const name of agents) {
    if (wordPattern(name).test(text)) add("agent", name);
  }
  for (const tool of INTERNAL_TOOLS) {
    if (agents.has(tool)) continue;
    if (wordPattern(tool, "giu").test(text)) add("tool", tool);
  }
  for (const client of ctx.otherClients) {
    const name = client.trim();
    if (name.length >= 4 && wordPattern(name, "giu").test(text)) {
      add("other_client", name);
    }
  }
  return [...found.values()];
}
