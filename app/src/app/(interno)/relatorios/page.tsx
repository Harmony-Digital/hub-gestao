import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Markdown } from "@/components/markdown";
import { FilterChip } from "@/components/shell/filter-chip";
import { PageHeader } from "@/components/shell/page-header";
import { Pill } from "@/components/shell/pill";
import { formatDate, formatTimestampDay } from "@/lib/format";
import type { Tone } from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  reportsOverview,
  type ReportGroup,
  type ReportState,
} from "@/modules/reports/overview";

export const metadata: Metadata = { title: "Relatórios" };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const STATE: Record<ReportState, { label: string; tone: Tone }> = {
  published: { label: "Publicado", tone: "ok" },
  pending: { label: "Esperando decisão", tone: "review" },
  superseded: { label: "Substituído por versão nova", tone: "neutral" },
  rejected: { label: "Recusado", tone: "danger" },
  adjust: { label: "Devolvido para ajuste", tone: "warn" },
  draft: { label: "Rascunho", tone: "neutral" },
};

const AUDIENCE: Record<"client" | "internal", string> = {
  client: "Para o cliente",
  internal: "Interno",
};

export default function RelatoriosPage({
  searchParams,
}: PageProps<"/relatorios">) {
  return (
    <>
      <PageHeader
        trail={[{ label: "Relatórios" }]}
        title="Relatórios"
        description="Os relatórios de status dos projetos, com todas as versões: quem preparou, o que mudou e o que foi publicado. Um relatório só é publicado com a aprovação do dono."
      />
      <main className="flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-8">
        <Suspense
          fallback={
            <div aria-busy="true" className="h-64 rounded-2xl bg-off-2" />
          }
        >
          <ReportsView searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function ReportsView({
  searchParams,
}: Pick<PageProps<"/relatorios">, "searchParams">) {
  const query = await searchParams;
  const audienceParam = first(query.publico);
  const audience =
    audienceParam === "cliente"
      ? "client"
      : audienceParam === "interno"
        ? "internal"
        : null;
  const { ctx } = await pageContext();
  const groups = await inTx(ctx, (t) => reportsOverview(t, { audience }));
  const href = (publico: string | null) =>
    publico ? `/relatorios?publico=${publico}` : "/relatorios";

  return (
    <>
      <FilterRow label="Para quem">
        <FilterChip href={href(null)} active={!audience}>
          Todos
        </FilterChip>
        <FilterChip href={href("cliente")} active={audience === "client"}>
          Para o cliente
        </FilterChip>
        <FilterChip href={href("interno")} active={audience === "internal"}>
          Internos
        </FilterChip>
      </FilterRow>
      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-sm text-ink-2">
          Nenhum relatório ainda. O Relator de Status (RL-03) prepara os
          rascunhos; cada um vira um pedido de aprovação no Hoje.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {groups.map((g) => (
            <ReportCard
              key={`${g.projectCode}-${g.audience}-${g.periodStart}-${g.periodEnd}`}
              group={g}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function ReportCard({ group: g }: { group: ReportGroup }) {
  const titleId = `relatorio-${g.projectCode}-${g.audience}-${g.periodStart}`;
  return (
    <li
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href={`/projetos/${g.projectCode}`}
          className="font-mono text-xs font-semibold text-ink-2 hover:text-navy hover:underline"
        >
          {g.projectCode}
        </Link>
        <h2
          id={titleId}
          className="font-heading text-base font-semibold text-navy"
        >
          {g.projectName}: de {formatDate(g.periodStart)} a{" "}
          {formatDate(g.periodEnd)}
        </h2>
        <Pill tone={g.audience === "client" ? "info" : "neutral"}>
          {AUDIENCE[g.audience]}
        </Pill>
      </div>
      <ol className="flex flex-col gap-2">
        {g.versions.map((v) => (
          <li key={v.id} className="rounded-xl bg-off">
            <details>
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
                <span className="font-semibold text-navy">
                  Versão {v.version}
                </span>
                <span className="text-ink-2">
                  {v.author ?? "Equipe"} · {formatTimestampDay(v.createdAt)}
                </span>
                <Pill tone={STATE[v.state].tone}>
                  {v.state === "published" && v.publishedAt
                    ? `Publicado em ${formatTimestampDay(v.publishedAt)}`
                    : STATE[v.state].label}
                </Pill>
                <span className="ml-auto text-xs text-caption">
                  Ver o texto
                </span>
              </summary>
              <div className="flex flex-col gap-2 border-t border-line px-3 py-2 text-sm text-ink">
                <Markdown text={v.bodyMd} />
                {v.state === "pending" ? (
                  <Link
                    href="/aprovacoes"
                    className="self-start text-sm font-semibold text-brand-strong hover:text-navy"
                  >
                    Decidir em Aprovações
                  </Link>
                ) : null}
              </div>
            </details>
          </li>
        ))}
      </ol>
    </li>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <nav
      aria-label={`Filtrar por ${label.toLowerCase()}`}
      className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3"
    >
      <span className="w-24 shrink-0 text-xs font-semibold tracking-[0.08em] text-caption uppercase">
        {label}
      </span>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        {children}
      </div>
    </nav>
  );
}
