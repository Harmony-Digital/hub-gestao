import { z } from "zod";

/**
 * O que o Planejador (PL-11) pede à IA: a árvore marcos → frentes → tarefas, com os
 * critérios de aceite, o prazo sugerido e os textos para o cliente de cada marco, mais as
 * premissas e dúvidas. Todos os campos obrigatórios, com null ou lista vazia para "não se
 * aplica" (o modo estrito da OpenAI não aceita campo opcional). Os limites de quantidade
 * são aplicados pelo Hub ao escrever o plan.md (render.ts), não pelo esquema.
 */

const PlanTask = z.object({
  title: z.string().describe("Uma ação, começando por verbo no infinitivo."),
  subtasks: z
    .array(z.string())
    .describe("Passos da tarefa, só quando houver; senão, lista vazia."),
});

const PlanWorkstream = z.object({
  title: z.string().describe("Frente do marco, título curto."),
  department: z
    .string()
    .nullable()
    .describe("Slug da lista DEPARTAMENTOS, ou null."),
  tasks: z.array(PlanTask),
});

const PlanMilestone = z.object({
  title: z.string().describe("Entrega do marco, título curto e sem código."),
  due_date: z
    .string()
    .nullable()
    .describe("Prazo sugerido, AAAA-MM-DD, só com base no documento."),
  acceptance_criteria: z
    .array(z.string())
    .describe("Critérios verificáveis do que o cliente vê funcionando."),
  client_title: z
    .string()
    .nullable()
    .describe("Título para o cliente, em segunda pessoa; null se interno."),
  client_summary: z
    .string()
    .nullable()
    .describe("Uma ou duas frases para o cliente; null se interno."),
  workstreams: z.array(PlanWorkstream),
});

export const PlanProposal = z.object({
  milestones: z.array(PlanMilestone),
  assumptions: z
    .array(z.string())
    .describe("Premissas e perguntas curtas para a pessoa conferir."),
});
export type PlanProposal = z.infer<typeof PlanProposal>;
