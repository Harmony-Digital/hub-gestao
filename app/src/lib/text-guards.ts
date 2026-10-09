import { unprocessable } from "@/lib/errors";

/**
 * Rede de segurança contra segredos em texto livre (AGENTS.md §11: nunca colocar
 * segredos em título, descrição, comentário ou evidência). Detecta formatos
 * conhecidos de chave e token; não substitui o cuidado de quem escreve.
 */
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "chave de agente do Hub", pattern: /hub_ak_[a-z0-9]{8,16}\.\S{16,}/ },
  { name: "chave da Anthropic", pattern: /sk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: "chave da OpenAI", pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: "chave da xAI", pattern: /xai-[A-Za-z0-9]{32,}/ },
  { name: "token do GitHub", pattern: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "chave da AWS", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "chave privada", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: "token JWT",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
];

export function findSecret(text: string): string | null {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

/** Recusa a gravação se algum campo parecer conter um segredo. */
export function assertNoSecrets(
  fields: Record<string, string | null | undefined>,
): void {
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    const found = findSecret(value);
    if (found) {
      throw unprocessable(
        `O campo ${field} parece conter um segredo (${found}). Remova o valor e descreva sem ele; segredos nunca entram no Hub.`,
        { field },
      );
    }
  }
}
