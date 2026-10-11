/**
 * Andamento que o cliente vê: o das tarefas do projeto (calculado no banco), mas nunca
 * abaixo da fatia de entregas já concluídas. O cliente não vê tarefas; com uma entrega
 * pronta, "0%" parecia projeto parado. Puro.
 */
export function clientProgress(
  taskPct: number,
  delivered: number,
  total: number,
): number {
  const tasks = Math.max(0, Math.min(100, Math.round(taskPct)));
  if (total <= 0) return tasks;
  const share = Math.round((100 * Math.min(delivered, total)) / total);
  return Math.max(tasks, share);
}
