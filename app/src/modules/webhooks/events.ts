import type { HubEvent } from "@/modules/events";

/**
 * Os eventos que um webhook de saída pode assinar, com o nome em PT-BR. Puro: a tela
 * importa daqui. Os três primeiros são os do Telegram do Fábio (PLAN.md, M5) e vêm
 * marcados no cadastro.
 */
export const WEBHOOK_EVENTS = [
  "approval.requested",
  "project.health_changed",
  "agent.budget_exceeded",
  "approval.decided",
  "milestone.status_changed",
  "report.published",
  "task.created",
  "task.updated",
  "task.completed",
  "task.blocked",
  "workstream.updated",
  "client.commented",
] as const satisfies readonly HubEvent[];
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const EVENT_LABEL: Record<WebhookEvent | "webhook.test", string> = {
  "approval.requested": "Pedido de aprovação aberto",
  "project.health_changed": "Saúde de projeto mudou",
  "agent.budget_exceeded": "Orçamento de IA de um agente acabou",
  "approval.decided": "Pedido decidido",
  "milestone.status_changed": "Marco mudou de situação",
  "report.published": "Relatório publicado",
  "task.created": "Tarefa criada",
  "task.updated": "Tarefa atualizada",
  "task.completed": "Tarefa concluída",
  "task.blocked": "Tarefa bloqueada",
  "workstream.updated": "Frente atualizada",
  "client.commented": "Cliente escreveu no portal",
  "webhook.test": "Teste",
};

/** Os do Telegram do Fábio: marcados por padrão no cadastro. */
export const DEFAULT_EVENTS: readonly WebhookEvent[] = [
  "approval.requested",
  "project.health_changed",
  "agent.budget_exceeded",
];
