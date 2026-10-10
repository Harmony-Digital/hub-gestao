/** Leitura dos endereços das telas do projeto (código, tarefa aberta e frente filtrada). */

export const PROJECT_CODE = /^[A-Z0-9]{2,8}$/;
export const TASK_CODE = /^[A-Z]{2,6}-[0-9]{1,9}$/;

export const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/** Tarefa aberta no painel (?tarefa=), só se o código tiver o formato certo. */
export function openTaskParam(value: string | string[] | undefined) {
  const code = firstParam(value);
  return code && TASK_CODE.test(code) ? code : null;
}

/** Endereço da visão com a frente filtrada (ou sem filtro). */
export function viewHref(basePath: string, frente: string | null): string {
  return frente ? `${basePath}?${new URLSearchParams({ frente })}` : basePath;
}
