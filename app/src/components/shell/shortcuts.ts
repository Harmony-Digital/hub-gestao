/**
 * Atalhos de teclado (RF-21): a regra de cada tecla, pura, para valer na tela e nos
 * testes. "/" busca, "c" cria tarefa, "?" mostra a lista e "g" seguido de uma letra leva
 * a uma tela (dentro de um projeto, também às abas dele). ⌘K continua na janela de busca.
 *
 * Atalho de uma tecla só pode atrapalhar quem usa leitor de tela ou ditado: a lista tem a
 * opção de desligar (WCAG 2.1.4), guardada neste navegador.
 */

export const SHORTCUTS_KEY = "hub:atalhos";
export const OPEN_SHORTCUTS_EVENT = "hub:abrir-atalhos";

export type ShortcutAction =
  | { kind: "search" }
  | { kind: "create" }
  | { kind: "help" }
  | { kind: "go"; href: string };

export const GO_TO: { key: string; href: string; label: string }[] = [
  { key: "h", href: "/", label: "Hoje" },
  { key: "t", href: "/minhas-tarefas", label: "Minhas tarefas" },
  { key: "p", href: "/projetos", label: "Projetos" },
  { key: "a", href: "/aprovacoes", label: "Aprovações" },
  { key: "d", href: "/departamentos", label: "Departamentos" },
  { key: "r", href: "/relatorios", label: "Relatórios" },
  { key: "i", href: "/caixa-de-entrada", label: "Caixa de entrada" },
  { key: "s", href: "/agentes", label: "Sala de Controle" },
];

/** Abas do projeto aberto: valem com "g" quando a tela é de um projeto. */
export const PROJECT_GO_TO: { key: string; tab: string; label: string }[] = [
  { key: "v", tab: "", label: "Visão geral do projeto" },
  { key: "l", tab: "/lista", label: "Lista do projeto" },
  { key: "q", tab: "/quadro", label: "Quadro do projeto" },
];

/** As teclas simples, como aparecem na lista. */
export const SINGLE_KEYS: { key: string; label: string }[] = [
  { key: "/", label: "Buscar" },
  { key: "c", label: "Nova tarefa" },
  { key: "?", label: "Esta lista de atalhos" },
];

const PROJECT_PATH = /^\/projetos\/([A-Z0-9]{2,8})(?:\/|$)/;

/** O código do projeto da tela atual (/projetos/CODIGO/…), se for de um projeto. */
export function projectOf(path: string): string | null {
  return PROJECT_PATH.exec(path)?.[1] ?? null;
}

/**
 * A ação de uma tecla. `afterG`: a tecla anterior foi "g" (a sequência vale por pouco
 * tempo; quem chama zera). Devolve também se a próxima tecla continua a sequência.
 */
export function shortcutFor(
  key: string,
  afterG: boolean,
  path: string,
): { action: ShortcutAction | null; afterG: boolean } {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (afterG) {
    const screen = GO_TO.find((g) => g.key === k);
    if (screen)
      return { action: { kind: "go", href: screen.href }, afterG: false };
    const project = projectOf(path);
    const tab = PROJECT_GO_TO.find((g) => g.key === k);
    if (project && tab) {
      return {
        action: { kind: "go", href: `/projetos/${project}${tab.tab}` },
        afterG: false,
      };
    }
    return { action: null, afterG: false };
  }
  if (k === "g") return { action: null, afterG: true };
  if (key === "/") return { action: { kind: "search" }, afterG: false };
  if (key === "?") return { action: { kind: "help" }, afterG: false };
  if (k === "c") return { action: { kind: "create" }, afterG: false };
  return { action: null, afterG: false };
}

/** Campos em que a tecla é do campo: escrever, escolher numa lista, editar texto. */
const KEEPS_KEYS = new Set(["TEXTAREA", "SELECT"]);
const INPUT_WITHOUT_TEXT = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "color",
  "file",
  "range",
]);

export type FocusedElement = {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
} | null;

/** O foco está num lugar em que a tecla vai para o campo (os atalhos não agem). */
export function focusKeepsKeys(el: FocusedElement): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (KEEPS_KEYS.has(tag)) return true;
  return (
    tag === "INPUT" &&
    !INPUT_WITHOUT_TEXT.has((el.type || "text").toLowerCase())
  );
}

/** Atalhos de uma tecla ligados neste navegador (o padrão é ligado). */
export function shortcutsOn(): boolean {
  try {
    return localStorage.getItem(SHORTCUTS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setShortcutsOn(on: boolean) {
  try {
    if (on) localStorage.removeItem(SHORTCUTS_KEY);
    else localStorage.setItem(SHORTCUTS_KEY, "off");
  } catch {
    // Sem acesso ao armazenamento do navegador: os atalhos seguem ligados.
  }
}

/** Abre a lista de atalhos de qualquer lugar (a janela ⌘K usa). */
export function openShortcuts() {
  window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
}
