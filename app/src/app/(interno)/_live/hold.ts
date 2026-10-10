/**
 * Quando a atualização ao vivo espera: com uma janela aberta, um cartão sendo arrastado
 * ou alguém digitando. Atualizar nessas horas trocaria a tela debaixo da mão de quem usa
 * (os formulários do painel recomeçam quando a versão da tarefa muda). A atualização só
 * fica para o próximo ciclo.
 */

let holds = 0;

/** Segura a atualização até a função devolvida ser chamada (vale chamar mais de uma vez). */
export function holdLive(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
  };
}

export function liveHeld(): boolean {
  return holds > 0;
}

/** Campos de digitar texto; seleção, caixa de marcar e busca não seguram a atualização. */
const TYPING = new Set([
  "text",
  "email",
  "url",
  "tel",
  "number",
  "password",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

export type FocusLike = {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
} | null;

export function isTyping(el: FocusLike): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && TYPING.has((el.type || "text").toLowerCase());
}
