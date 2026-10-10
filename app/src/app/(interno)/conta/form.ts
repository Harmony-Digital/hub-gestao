/**
 * Definição de senha pela própria pessoa (tela Minha conta). Regras simples e claras:
 * de 10 a 72 caracteres (72 é o limite do bcrypt do Supabase Auth) e a confirmação igual.
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72;

export type PasswordFormState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export const INITIAL_PASSWORD_FORM: PasswordFormState = { status: "idle" };

export function parsePasswordForm(
  form: FormData,
): { ok: true; password: string } | { ok: false; message: string } {
  const password = form.get("password");
  const confirmation = form.get("confirmation");
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, message: "Digite a nova senha." };
  }
  if (password.length < PASSWORD_MIN) {
    return {
      ok: false,
      message: `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`,
    };
  }
  if (password.length > PASSWORD_MAX) {
    return {
      ok: false,
      message: `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`,
    };
  }
  if (password.trim() !== password) {
    return {
      ok: false,
      message: "Tire os espaços do começo e do fim da senha.",
    };
  }
  if (password !== confirmation) {
    return { ok: false, message: "A confirmação não é igual à nova senha." };
  }
  return { ok: true, password };
}
