/**
 * Tema da interface (decisão D4): claro por padrão; escuro "Sala de Controle" como opção
 * de quem usa, ou seguindo o sistema. A escolha fica neste navegador; o script do
 * `src/app/layout.tsx` aplica antes de desenhar, com a mesma regra de `isDark`.
 */

export type ThemeChoice = "claro" | "escuro" | "sistema";

export const THEME_KEY = "hub:tema";
export const THEME_EVENT = "hub:tema-mudou";

export const THEME_LABELS: Record<ThemeChoice, string> = {
  claro: "Claro",
  escuro: "Escuro (Sala de Controle)",
  sistema: "Seguir o sistema",
};

export function parseTheme(value: string | null | undefined): ThemeChoice {
  return value === "escuro" || value === "sistema" ? value : "claro";
}

export function isDark(choice: ThemeChoice, systemDark: boolean): boolean {
  return choice === "escuro" || (choice === "sistema" && systemDark);
}

export function readTheme(): ThemeChoice {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return "claro";
  }
}

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Liga ou desliga a classe `dark` do `<html>` conforme a escolha. */
export function applyTheme(choice: ThemeChoice = readTheme()) {
  document.documentElement.classList.toggle(
    "dark",
    isDark(choice, systemDark()),
  );
}

export function setTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Sem armazenamento (navegação privada): vale só até recarregar.
  }
  applyTheme(choice);
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Para `useSyncExternalStore`: avisa quando a escolha ou o tema do sistema mudam. */
export function subscribeTheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(THEME_EVENT, onChange);
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    media.removeEventListener("change", onChange);
  };
}

/** O tema escuro está valendo agora? */
export function darkNow(): boolean {
  return document.documentElement.classList.contains("dark");
}
