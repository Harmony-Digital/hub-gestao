/**
 * As cinco categorias fixas de status de tarefa e os nomes delas em PT-BR. Puro: vale no
 * servidor, nas telas (navegador) e nos testes.
 */

export const STATUS_CATEGORIES = [
  "todo",
  "in_progress",
  "review",
  "blocked",
  "done",
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const STATUS_CATEGORY_LABEL: Record<StatusCategory, string> = {
  todo: "A fazer",
  in_progress: "Em andamento",
  review: "Em revisão",
  blocked: "Bloqueada",
  done: "Concluída",
};
