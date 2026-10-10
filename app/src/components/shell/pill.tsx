import type { ReactNode } from "react";
import { TONE_CLASS, type Tone } from "@/lib/labels";

/** Selo de estado (saúde, status, prioridade), sempre com texto além da cor. */
export function Pill({
  tone,
  children,
  className = "",
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Barra de progresso fina, com o número ao lado para quem não enxerga a cor. */
export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex items-center gap-2">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Progresso"}
        className="h-1.5 w-20 overflow-hidden rounded-full bg-off-2"
      >
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-xs text-ink-2">{pct}%</span>
    </div>
  );
}

/** Avatar com iniciais; agentes em laranja, pessoas em azul-marinho. */
export function Avatar({
  text,
  agent = false,
  title,
}: {
  text: string;
  agent?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      aria-hidden={title ? undefined : true}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${
        agent ? "bg-brand-soft/30 text-brand-strong" : "bg-navy text-off"
      }`}
    >
      {text}
    </span>
  );
}
