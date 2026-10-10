/** Estado da tela de login entre um envio e outro (compartilhado com o formulário). */
export type LoginState =
  | { status: "idle" }
  | { status: "error"; message: string; email?: string }
  | { status: "sent"; message: string };

export const INITIAL_LOGIN_STATE: LoginState = { status: "idle" };
