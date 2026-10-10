/** Resultado de uma ação de formulário (server action), igual em todas as telas. */
export type ActionState =
  | { status: "idle" }
  | { status: "ok"; message?: string }
  | { status: "error"; message: string };

export const IDLE: ActionState = { status: "idle" };
