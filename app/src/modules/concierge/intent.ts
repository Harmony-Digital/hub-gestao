import { z } from "zod";
import { STATUS_CATEGORIES } from "@/modules/tasks/status-categories";

/**
 * O que o Concierge (CO-10) pede à IA: uma ação só, num objeto plano. Todos os campos são
 * obrigatórios, com null para "não se aplica", porque o modo estrito da OpenAI não aceita
 * campo opcional (vale igual na Anthropic e na xAI). Os valores livres (projeto, pessoa,
 * data) ainda passam pela conferência do Hub antes da prévia (resolve.ts): a IA aponta,
 * o código confere.
 */

export const CONCIERGE_KINDS = [
  "create_task",
  "update_task",
  "comment",
  "approval",
  "question",
  "navigate",
  "unknown",
] as const;
export type ConciergeKind = (typeof CONCIERGE_KINDS)[number];

export const CONCIERGE_QUESTIONS = [
  "blocked",
  "overdue",
  "due_soon",
  "my_tasks",
  "pending_approvals",
  "project_status",
] as const;
export type ConciergeQuestion = (typeof CONCIERGE_QUESTIONS)[number];

export const CONCIERGE_SCREENS = [
  "hoje",
  "minhas_tarefas",
  "projetos",
  "aprovacoes",
  "caixa_de_entrada",
  "sala_de_controle",
  "clientes",
  "conta",
  "projeto",
  "lista",
  "quadro",
] as const;
export type ConciergeScreen = (typeof CONCIERGE_SCREENS)[number];

export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;

export const ConciergeIntent = z.object({
  kind: z.enum(CONCIERGE_KINDS).describe("Tipo da ação."),
  project: z
    .string()
    .nullable()
    .describe("Código do projeto, da lista PROJETOS."),
  task: z.string().nullable().describe("Código da tarefa citada, como HUB-12."),
  title: z
    .string()
    .nullable()
    .describe("Título da tarefa nova, ou o título novo de uma tarefa."),
  description: z
    .string()
    .nullable()
    .describe("Detalhes da tarefa nova, se o pedido trouxer."),
  due_date: z.string().nullable().describe("Prazo, no formato AAAA-MM-DD."),
  priority: z.enum(PRIORITIES).nullable(),
  assignee: z
    .string()
    .nullable()
    .describe('Nome exato da lista EQUIPE, ou "eu".'),
  status: z.enum(STATUS_CATEGORIES).nullable(),
  reason: z
    .string()
    .nullable()
    .describe("Evidência ao concluir, ou motivo ao bloquear."),
  comment: z.string().nullable().describe("Texto do comentário."),
  approval: z
    .number()
    .int()
    .nullable()
    .describe("Número do pedido na lista PEDIDOS DE APROVAÇÃO."),
  question: z.enum(CONCIERGE_QUESTIONS).nullable(),
  screen: z.enum(CONCIERGE_SCREENS).nullable(),
  note: z
    .string()
    .nullable()
    .describe("Uma frase curta, quando faltar algo ou o pedido não couber."),
});
export type ConciergeIntent = z.infer<typeof ConciergeIntent>;
