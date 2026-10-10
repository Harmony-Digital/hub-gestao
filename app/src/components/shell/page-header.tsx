import Link from "next/link";
import type { ReactNode } from "react";

export type Crumb = { label: string; href?: string };

/** Topo de cada tela: trilha, título, explicação curta e ações. */
export function PageHeader({
  trail,
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  trail: Crumb[];
  /** Linha curta acima do título (por exemplo, a data de hoje). */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-line bg-paper px-4 pt-5 pb-5 sm:px-8">
      <nav aria-label="Trilha" className="text-sm text-caption">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>Harmony Digital</li>
          {trail.map((crumb, i) => (
            <li
              key={`${crumb.label}-${i}`}
              className="flex items-center gap-1.5"
            >
              <span aria-hidden="true">/</span>
              {crumb.href && i < trail.length - 1 ? (
                <Link href={crumb.href} className="hover:text-navy">
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={i === trail.length - 1 ? "page" : undefined}
                  className={i === trail.length - 1 ? "text-ink-2" : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          {eyebrow ? (
            <p className="font-mono text-[11px] tracking-[0.12em] text-brand-strong uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-navy sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <div className="max-w-3xl leading-relaxed text-ink-2">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
