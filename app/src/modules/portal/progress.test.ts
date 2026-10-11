import { describe, expect, it } from "vitest";
import { clientProgress } from "./progress";

describe("andamento no portal", () => {
  it("nunca fica abaixo da fatia de entregas concluídas", () => {
    expect(clientProgress(0, 1, 4)).toBe(25);
    expect(clientProgress(8, 1, 4)).toBe(25);
    expect(clientProgress(60, 1, 4)).toBe(60);
    expect(clientProgress(90, 4, 4)).toBe(100);
  });

  it("sem entregas para o cliente, vale o andamento das tarefas", () => {
    expect(clientProgress(37.4, 0, 0)).toBe(37);
    expect(clientProgress(0, 0, 3)).toBe(0);
  });
});
