/** Resposta da equipe no canal do cliente: leitura pura do formulário. */

export type ReplyState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; message: string };

export const REPLY_IDLE: ReplyState = { status: "idle" };

export const REPLY_MAX = 4000;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseReplyForm(
  form: FormData,
): Parsed<{ project: string; body: string }> {
  const project = String(form.get("project") ?? "");
  if (!/^[A-Z0-9]{2,8}$/.test(project)) {
    return { ok: false, message: "Projeto inválido. Recarregue a página." };
  }
  const body = String(form.get("body") ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!body)
    return { ok: false, message: "Escreva a mensagem antes de enviar." };
  if (body.length > REPLY_MAX) {
    return {
      ok: false,
      message: `A mensagem passou de ${REPLY_MAX} caracteres. Divida em duas.`,
    };
  }
  return { ok: true, value: { project, body } };
}
