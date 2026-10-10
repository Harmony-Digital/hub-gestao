"use client";

import { useId, useSyncExternalStore } from "react";
import {
  readTheme,
  setTheme,
  subscribeTheme,
  THEME_LABELS,
  type ThemeChoice,
} from "@/components/shell/theme";

const CHOICES: ThemeChoice[] = ["claro", "escuro", "sistema"];

/** Escolha do tema (D4): claro por padrão, escuro como opção, ou seguir o sistema. */
export function Aparencia() {
  const current = useSyncExternalStore(
    subscribeTheme,
    readTheme,
    () => "claro",
  );
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Tema</legend>
      {CHOICES.map((choice) => (
        <label
          key={choice}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 text-sm text-ink has-[:checked]:border-brand has-[:checked]:bg-brand/10"
        >
          <input
            type="radio"
            name={name}
            value={choice}
            checked={current === choice}
            onChange={() => setTheme(choice)}
            className="size-4 accent-[var(--color-brand)]"
          />
          {THEME_LABELS[choice]}
        </label>
      ))}
      <p className="text-xs text-caption">
        A escolha vale neste navegador. O tema claro é o padrão da Harmony; o
        escuro segue o visual da Sala de Controle.
      </p>
    </fieldset>
  );
}
