import { describe, expect, it } from "vitest";
import { focusKeepsKeys, projectOf, shortcutFor } from "./shortcuts";

describe("atalhos de teclado (RF-21)", () => {
  it("teclas simples: busca, nova tarefa e a lista", () => {
    expect(shortcutFor("/", false, "/").action).toEqual({ kind: "search" });
    expect(shortcutFor("c", false, "/").action).toEqual({ kind: "create" });
    expect(shortcutFor("C", false, "/").action).toEqual({ kind: "create" });
    expect(shortcutFor("?", false, "/").action).toEqual({ kind: "help" });
    expect(shortcutFor("x", false, "/")).toEqual({
      action: null,
      afterG: false,
    });
  });

  it("g e uma letra leva à tela; letra sem tela não faz nada", () => {
    const g = shortcutFor("g", false, "/");
    expect(g).toEqual({ action: null, afterG: true });
    expect(shortcutFor("h", true, "/").action).toEqual({
      kind: "go",
      href: "/",
    });
    expect(shortcutFor("a", true, "/").action).toEqual({
      kind: "go",
      href: "/aprovacoes",
    });
    expect(shortcutFor("s", true, "/").action).toEqual({
      kind: "go",
      href: "/agentes",
    });
    expect(shortcutFor("z", true, "/")).toEqual({
      action: null,
      afterG: false,
    });
  });

  it("dentro de um projeto, g leva às abas dele; fora, não", () => {
    expect(projectOf("/projetos/EXE/lista")).toBe("EXE");
    expect(projectOf("/projetos/EXE")).toBe("EXE");
    expect(projectOf("/projetos")).toBeNull();
    expect(projectOf("/projetos/novo")).toBeNull();
    expect(shortcutFor("q", true, "/projetos/EXE/lista").action).toEqual({
      kind: "go",
      href: "/projetos/EXE/quadro",
    });
    expect(shortcutFor("v", true, "/projetos/EXE/quadro").action).toEqual({
      kind: "go",
      href: "/projetos/EXE",
    });
    expect(shortcutFor("q", true, "/minhas-tarefas").action).toBeNull();
  });

  it("com o foco num campo, a tecla é do campo", () => {
    expect(focusKeepsKeys({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(focusKeepsKeys({ tagName: "INPUT" })).toBe(true);
    expect(focusKeepsKeys({ tagName: "input", type: "date" })).toBe(true);
    expect(focusKeepsKeys({ tagName: "TEXTAREA" })).toBe(true);
    expect(focusKeepsKeys({ tagName: "SELECT" })).toBe(true);
    expect(focusKeepsKeys({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
    expect(focusKeepsKeys({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(focusKeepsKeys({ tagName: "BUTTON" })).toBe(false);
    expect(focusKeepsKeys(null)).toBe(false);
  });
});
