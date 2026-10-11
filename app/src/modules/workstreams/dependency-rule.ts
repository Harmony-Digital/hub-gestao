/**
 * Regra das dependências entre frentes (RF-13), pura: a frente que depende de outra só
 * deveria começar depois de a outra terminar. Vale para o alerta da Visão geral e para a
 * saúde do projeto ("dependência quebrada", PRD §5.7). A Linha do tempo tem o alerta pelas
 * datas planejadas (`timeline-layout.ts`); este é o do que já aconteceu.
 */

export type DependencyNode = {
  id: string;
  title: string;
  status: "planned" | "in_progress" | "blocked" | "done";
  /** Alguma tarefa da frente já saiu de "a fazer" (começou, em revisão, bloqueada ou feita). */
  tasksStarted: boolean;
  /** Frentes de que esta depende (ids). */
  dependsOn: string[];
};

export type DependencyAlert = {
  id: string;
  title: string;
  /** Frentes de que esta depende e que ainda não terminaram, na ordem da lista. */
  waitingOn: { id: string; title: string }[];
};

/**
 * A frente começou: em andamento, bloqueada ou com tarefa começada. Concluída não conta
 * (já terminou), e Planejada sem tarefa começada ainda está esperando, como deve.
 */
export function hasStarted(
  node: Pick<DependencyNode, "status" | "tasksStarted">,
) {
  if (node.status === "done") return false;
  return (
    node.status === "in_progress" ||
    node.status === "blocked" ||
    node.tasksStarted
  );
}

/** Frentes que começaram antes de terminar alguma frente de que dependem. */
export function dependencyAlerts(nodes: DependencyNode[]): DependencyAlert[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const alerts: DependencyAlert[] = [];
  for (const node of nodes) {
    if (!hasStarted(node)) continue;
    const waitingOn = node.dependsOn
      .map((id) => byId.get(id))
      .filter((d): d is DependencyNode => Boolean(d) && d!.status !== "done")
      .map((d) => ({ id: d.id, title: d.title }));
    if (waitingOn.length > 0) {
      alerts.push({ id: node.id, title: node.title, waitingOn });
    }
  }
  return alerts;
}
