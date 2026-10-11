/**
 * O erro como vai para o log (AGENTS.md §5.2: sem dado pessoal e sem segredo). O Postgres
 * põe valores no `detail` (como o e-mail repetido de uma chave única) e no `where`; o
 * provedor de IA pode citar a chave na mensagem. Fica o tipo, o código, a mensagem curta
 * e o começo da pilha, com e-mail, chave e token trocados por marcadores.
 */

const PATTERNS: [RegExp, string][] = [
  // Primeiro o cabeçalho inteiro, para não sobrar pedaço da credencial.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [removido]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail]"],
  [/\bhub_ak_[A-Za-z0-9_-]+/g, "[chave]"],
  [/\bwhsec_[A-Za-z0-9_-]+/g, "[segredo]"],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "[chave]"],
  [/\bxai-[A-Za-z0-9_-]{8,}/g, "[chave]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]"],
  [/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[removido]@"],
];

/** Troca e-mail, chave, token e senha de endereço de banco por marcadores. */
export function scrub(text: string): string {
  return PATTERNS.reduce(
    (out, [pattern, mark]) => out.replace(pattern, mark),
    text,
  );
}

export function safeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { message: scrub(String(err)).slice(0, 300) };
  }
  const e = err as Error & { code?: unknown; status?: unknown };
  const out: Record<string, unknown> = {
    type: e.name,
    message: scrub(e.message).slice(0, 300),
  };
  if (typeof e.code === "string") out.code = e.code;
  if (typeof e.status === "number") out.status = e.status;
  if (e.stack) {
    out.stack = scrub(e.stack).split("\n").slice(0, 12).join("\n");
  }
  return out;
}
