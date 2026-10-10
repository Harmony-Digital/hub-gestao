"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef } from "react";
import { isTyping, liveHeld } from "./hold";

const EVERY_MS = 10_000;
const RETRY_MS = 3_000;
const MAX_WAIT_MS = 120_000;

/**
 * Atualiza a tela sozinha quando o projeto muda (uma pessoa ou um agente gravou algo):
 * com a aba visível, confere a marca de mudança a cada 10 segundos e, se ela mudou, pede
 * ao servidor a tela de novo, sem recarregar a página nem perder filtros e painel. Espera
 * enquanto há janela aberta, arraste ou digitação. Falhas seguidas espaçam as consultas.
 */
export function LiveRefresh({ src, marker }: { src: string; marker: string }) {
  const router = useRouter();
  const known = useRef(marker);

  useEffect(() => {
    known.current = marker;
  }, [marker]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let failures = 0;

    function schedule(ms: number) {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, ms);
    }

    async function tick() {
      if (document.visibilityState !== "visible") return schedule(EVERY_MS);
      let next = EVERY_MS;
      try {
        const res = await fetch(src, {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const body =
          res.ok && res.headers.get("content-type")?.includes("json")
            ? ((await res.json()) as { marker?: unknown })
            : null;
        if (typeof body?.marker !== "string") throw new Error("sem marca");
        failures = 0;
        if (body.marker !== known.current) {
          if (busy()) {
            next = RETRY_MS;
          } else {
            known.current = body.marker;
            startTransition(() => router.refresh());
          }
        }
      } catch {
        failures += 1;
        next = Math.min(EVERY_MS * 2 ** failures, MAX_WAIT_MS);
      }
      schedule(next);
    }

    // Ao voltar para a aba, confere na hora.
    const onVisible = () => {
      if (document.visibilityState === "visible") schedule(0);
    };
    schedule(EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [src, router]);

  return null;
}

function busy(): boolean {
  return (
    liveHeld() ||
    document.querySelector("dialog[open]") !== null ||
    isTyping(document.activeElement as HTMLElement | null)
  );
}
