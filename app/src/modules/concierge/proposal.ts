import { z } from "zod";
import {
  IsoDate,
  Line,
  Priority,
  ProjectCode,
  TaskCode,
  Text,
  Uuid,
} from "@/modules/common";
import type { StatusCategory } from "@/modules/tasks/status-categories";
import { AssigneeInput } from "@/modules/tasks/schemas";

/**
 * A prévia do Concierge (o que a pessoa vê antes de confirmar) e o comando confirmado (o
 * que a tela manda executar). A tela importa só os tipos; o comando é conferido de novo
 * no servidor, porque a pessoa pode ter editado a prévia.
 */

export type PriorityValue = z.infer<typeof Priority>;

export type Choice = { value: string; label: string };

export type TaskRef = {
  code: string;
  title: string;
  project_code: string;
  version: number;
  status_name: string;
  status_category: StatusCategory;
};

export type StatusChoice = {
  id: string;
  name: string;
  category: StatusCategory;
};

export type AnswerItem = { label: string; hint: string | null; href: string };

export type CreateTaskProposal = {
  kind: "create_task";
  draft: {
    project: string;
    title: string;
    description: string;
    due_date: string;
    priority: PriorityValue;
    /** "", "me", "user:<id>" ou "agent:<id>". */
    assignee: string;
  };
  projects: Choice[];
  team: Choice[];
  notes: string[];
};

export type UpdateTaskProposal = {
  kind: "update_task";
  task: TaskRef;
  /** Só o que muda; null é "fica como está". */
  changes: {
    status_id: string | null;
    due_date: string | null;
    priority: PriorityValue | null;
    assignee: string | null;
    title: string | null;
  };
  /** Evidência (ao concluir) ou motivo (ao bloquear), se o pedido disse. */
  reason: string;
  statuses: StatusChoice[];
  team: Choice[];
  notes: string[];
};

export type CommentProposal = {
  kind: "comment";
  task: TaskRef;
  body: string;
  notes: string[];
};

export type AnswerProposal = {
  kind: "answer";
  title: string;
  items: AnswerItem[];
  /** O que dizer quando não há nada (a resposta nunca inventa). */
  empty: string;
  /** A tela com a lista completa, quando a resposta foi cortada. */
  more: { label: string; href: string } | null;
};

export type NavigateProposal = {
  kind: "navigate";
  label: string;
  href: string;
};

export type UnknownProposal = { kind: "unknown"; message: string };

/** Pedido de aprovação achado: a tela mostra o cartão de decisão de sempre. */
export type ApprovalProposal = { kind: "approval"; approvalId: string };

export type ConciergeProposal =
  | CreateTaskProposal
  | UpdateTaskProposal
  | CommentProposal
  | ApprovalProposal
  | AnswerProposal
  | NavigateProposal
  | UnknownProposal;

/** O comando confirmado (depois da prévia, com o que a pessoa editou). */
export const ConciergeCommand = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("create_task"),
    project: ProjectCode,
    title: Line(300),
    description_md: z.string().trim().max(20000).optional(),
    priority: Priority,
    due_date: IsoDate.optional(),
    assignee: AssigneeInput.optional(),
  }),
  z.strictObject({
    kind: z.literal("update_task"),
    task: TaskCode,
    version: z.number().int().min(1),
    status_id: Uuid.optional(),
    evidence: z.string().trim().min(1).max(2000).optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
    due_date: IsoDate.optional(),
    priority: Priority.optional(),
    assignee: AssigneeInput.optional(),
    title: Line(300).optional(),
  }),
  z.strictObject({
    kind: z.literal("comment"),
    task: TaskCode,
    body_md: Text(10000),
  }),
]);
export type ConciergeCommand = z.infer<typeof ConciergeCommand>;

/** Para as métricas do CO-10 (AGENTES.md): editou a prévia, falou ou digitou, tempo. */
export type ConciergeMeta = {
  edited: boolean;
  voice: boolean;
  /** Segundos do pedido até a confirmação (null se a tela não mandou). */
  seconds: number | null;
};
