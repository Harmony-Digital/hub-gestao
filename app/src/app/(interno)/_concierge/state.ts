import type { ConciergeProposal } from "@/modules/concierge/proposal";
import type { DecisionItem } from "../_approvals/view";

/** O que a tela do Concierge mostra: a prévia ou o cartão de decisão de sempre. */
export type ConciergeView =
  | Exclude<ConciergeProposal, { kind: "approval" }>
  | { kind: "approval"; item: DecisionItem; canDecide: boolean };

export type InterpretState =
  { ok: true; view: ConciergeView } | { ok: false; message: string };

export type ConfirmState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "done";
      message: string;
      code: string;
      href: string;
      /** Tarefa nova: a tela abre a tarefa no projeto. */
      created: boolean;
    };

export const CONFIRM_IDLE: ConfirmState = { status: "idle" };
