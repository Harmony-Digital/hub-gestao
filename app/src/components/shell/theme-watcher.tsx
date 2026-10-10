"use client";

import { useEffect } from "react";
import { applyTheme, readTheme } from "./theme";

/**
 * Com "Seguir o sistema", acompanha a troca de claro para escuro do aparelho enquanto a
 * tela está aberta. Não desenha nada.
 */
export function ThemeWatcher() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readTheme() === "sistema") applyTheme("sistema");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return null;
}
