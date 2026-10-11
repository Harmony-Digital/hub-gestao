/** Formulário "Escreva para a equipe" do portal: leitura pura do que vem da tela. */

export type MessageState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ok"; message: string };

export const MESSAGE_IDLE: MessageState = { status: "idle" };

export const MESSAGE_MAX = 4000;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

export function parseMessageForm(
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
  if (body.length > MESSAGE_MAX) {
    return {
      ok: false,
      message: `A mensagem passou de ${MESSAGE_MAX} caracteres. Divida em duas.`,
    };
  }
  return { ok: true, value: { project, body } };
}

/** "Receber um link novo" (RF-05): só o e-mail, no formato de um endereço. */
export function parseLinkRequestForm(
  form: FormData,
): Parsed<{ email: string }> {
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(email)
  ) {
    return {
      ok: false,
      message: "Escreva o e-mail em que você recebeu o convite do portal.",
    };
  }
  return { ok: true, value: { email } };
}
