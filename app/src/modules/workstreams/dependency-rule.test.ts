import { describe, expect, it } from "vitest";
import {
  dependencyAlerts,
  hasStarted,
  type DependencyNode,
} from "./dependency-rule";

const node = (
  over: Partial<DependencyNode> & { id: string },
): DependencyNode => ({
  title: over.id.toUpperCase(),
  status: "planned",
  tasksStarted: false,
  dependsOn: [],
  ...over,
});

describe("regra das dependências entre frentes (RF-13)", () => {
  it("a frente começou: em andamento, bloqueada ou com tarefa começada", () => {
    expect(hasStarted({ status: "planned", tasksStarted: false })).toBe(false);
    expect(hasStarted({ status: "planned", tasksStarted: true })).toBe(true);
    expect(hasStarted({ status: "in_progress", tasksStarted: false })).toBe(
      true,
    );
    expect(hasStarted({ status: "blocked", tasksStarted: false })).toBe(true);
    // Concluída já terminou: não entra no alerta.
    expect(hasStarted({ status: "done", tasksStarted: true })).toBe(false);
  });

  it("avisa só quem começou antes de terminar alguma frente de que depende", () => {
    const alerts = dependencyAlerts([
      node({ id: "a", status: "in_progress" }),
      node({ id: "b", status: "done" }),
      node({ id: "c", status: "in_progress", dependsOn: ["a", "b"] }),
      node({ id: "d", status: "planned", dependsOn: ["a"] }),
      node({
        id: "e",
        status: "planned",
        tasksStarted: true,
        dependsOn: ["b"],
      }),
      // Dependência que não está na lista (arquivada): ignorada.
      node({ id: "f", status: "in_progress", dependsOn: ["x"] }),
    ]);
    expect(alerts).toEqual([
      { id: "c", title: "C", waitingOn: [{ id: "a", title: "A" }] },
    ]);
  });
});
