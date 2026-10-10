/**
 * Separa endereços http(s) do texto livre (descrição, comentário, evidência) para virar
 * link na tela. Só http e https: nada de javascript:, data: ou outros esquemas.
 */
export type TextPart =
  { type: "text"; value: string } | { type: "link"; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
/** Pontuação que costuma fechar a frase, não o endereço. */
const TRAILING = /[.,;:!?)\]}]+$/;

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    const href = match[0].replace(TRAILING, "");
    if (href.length <= "https://".length) continue;
    if (start > last)
      parts.push({ type: "text", value: text.slice(last, start) });
    parts.push({ type: "link", href });
    last = start + href.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}
