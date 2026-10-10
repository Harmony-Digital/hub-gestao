import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { CornerDownRight, MessageSquareText } from "lucide-react";
import { FilterChip } from "@/components/shell/filter-chip";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, Pill } from "@/components/shell/pill";
import { can } from "@/lib/authorize";
import { initials } from "@/lib/format";
import { APPROVAL_TYPE } from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import { listApprovals } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import { DecisionList } from "../_approvals/decision-list";
import {
  decisionView,
  historyView,
  type HistoryItem,
} from "../_approvals/view";
import {
  applyFilters,
  filtersHref,
  parseFilters,
  type ApprovalFilters,
  type StatusFilter,
} from "./filters";

export const metadata: Metadata = { title: "Aprovações" };

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function AprovacoesPage({
  searchParams,
}: PageProps<"/aprovacoes">) {
  return (
    <>
      <PageHeader
        trail={[{ label: "Aprovações" }]}
        title="Aprovações"
        description="Tudo o que pede um sim: pedidos dos agentes e da equipe, com o que muda ao aprovar, e o histórico do que já foi decidido."
      />
      <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
        <Suspense fallback={<ApprovalsSkeleton />}>
          <ApprovalsView searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

const STATUS_LABEL: Record<StatusFilter, string> = {
  pendentes: "Pendentes",
  historico: "Histórico",
  todas: "Todas",
};

async function ApprovalsView({
  searchParams,
}: Pick<PageProps<"/aprovacoes">, "searchParams">) {
  const query = await searchParams;
  const filters = parseFilters({
    status: first(query.status),
    tipo: first(query.tipo),
    projeto: first(query.projeto),
  });
  const { ctx } = await pageContext();
  // Sem filtro no banco: os 200 pedidos mais recentes no escopo de quem vê, filtrados aqui.
  const { items, canDecide } = await inTx(ctx, async (t) => ({
    items: (await listApprovals(t, {})).items,
    canDecide: can(t.actor, "approval.decide"),
  }));
  const { visible, counts, types, projects } = applyFilters(items, filters);
  const now = new Date();
  const pending = visible
    .filter((a) => a.status === "pending")
    .map((a) => decisionView(a, now));
  const history = visible
    .filter((a) => a.status !== "pending")
    .map((a) => historyView(a, now));
  const href = (change: Partial<ApprovalFilters>) =>
    filtersHref({ ...filters, ...change });

  return (
    <>
      <div className="flex flex-col gap-3">
        <FilterRow label="Situação">
          {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((s) => (
            <FilterChip
              key={s}
              href={href({ status: s })}
              active={filters.status === s}
            >
              {STATUS_LABEL[s]}
              <span className="font-mono text-xs opacity-80">{counts[s]}</span>
            </FilterChip>
          ))}
        </FilterRow>
        {types.length > 1 || filters.type ? (
          <FilterRow label="Tipo">
            <FilterChip href={href({ type: null })} active={!filters.type}>
              Todos os tipos
            </FilterChip>
            {types.map((t) => (
              <FilterChip
                key={t}
                href={href({ type: t })}
                active={filters.type === t}
              >
                {APPROVAL_TYPE[t].label}
              </FilterChip>
            ))}
          </FilterRow>
        ) : null}
        {projects.length > 1 || filters.project ? (
          <FilterRow label="Projeto">
            <FilterChip
              href={href({ project: null })}
              active={!filters.project}
            >
              Todos os projetos
            </FilterChip>
            {projects.map((code) => (
              <FilterChip
                key={code}
                href={href({ project: code })}
                active={filters.project === code}
              >
                <span className="font-mono text-xs">{code}</span>
              </FilterChip>
            ))}
          </FilterRow>
        ) : null}
      </div>

      {filters.status !== "historico" ? (
        <section aria-labelledby="pendentes" className="flex flex-col gap-3">
          <h2
            id="pendentes"
            className="flex items-center gap-2 font-heading text-lg font-semibold text-navy"
          >
            {canDecide ? "Esperando a sua decisão" : "Seus pedidos em aberto"}
            <span className="font-mono text-sm font-normal text-caption">
              {pending.length}
            </span>
          </h2>
          <DecisionList
            items={pending}
            canDecide={canDecide}
            emptyText={
              filters.type || filters.project
                ? "Nenhum pedido pendente com este filtro."
                : "Nada esperando decisão. Os agentes avisam quando surgir algo novo."
            }
          />
        </section>
      ) : null}

      {filters.status !== "pendentes" ? (
        <section aria-labelledby="historico" className="flex flex-col gap-3">
          <h2
            id="historico"
            className="flex items-center gap-2 font-heading text-lg font-semibold text-navy"
          >
            Histórico
            <span className="font-mono text-sm font-normal text-caption">
              {history.length}
            </span>
          </h2>
          {history.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
              Nenhuma decisão registrada
              {filters.type || filters.project ? " com este filtro" : " ainda"}.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {history.map((item) => (
                <HistoryCard key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {items.length >= 200 ? (
        <p className="text-xs text-caption">
          Mostrando os 200 pedidos mais recentes.
        </p>
      ) : null}
    </>
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
      <span className="w-20 shrink-0 text-xs font-semibold tracking-[0.08em] text-caption uppercase">
        {label}
      </span>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        {children}
      </div>
    </nav>
  );
}

function HistoryCard({ item }: { item: HistoryItem }) {
  const titleId = `historico-${item.id}`;
  return (
    <li
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-caption">
        <Pill tone={item.tone}>{item.typeLabel}</Pill>
        {item.projectCode ? (
          <Link
            href={`/projetos/${item.projectCode}`}
            className="font-mono font-semibold text-ink-2 hover:text-navy hover:underline"
          >
            {item.projectCode}
          </Link>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <Pill tone={item.outcomeTone}>{item.outcome}</Pill>
          {item.decidedBy || item.decidedOn ? (
            <span>
              {item.decidedBy ? `por ${item.decidedBy}` : ""}
              {item.decidedOn ? ` em ${item.decidedOn}` : ""}
            </span>
          ) : null}
        </span>
      </div>
      <h3
        id={titleId}
        className="font-heading text-base leading-snug font-semibold text-navy"
      >
        {item.title}
      </h3>
      {item.summary ? (
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-ink-2">
          {item.summary}
        </p>
      ) : null}
      {item.note ? (
        <p className="flex gap-2 rounded-xl bg-off p-3 text-sm text-ink">
          <MessageSquareText
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-caption"
          />
          <span className="break-words whitespace-pre-wrap">
            <span className="font-semibold text-navy">
              {item.outcome === "Recusado" ? "Motivo: " : "Orientação: "}
            </span>
            {item.note}
          </span>
        </p>
      ) : null}
      {item.result ? (
        <p className="flex gap-2 text-sm text-ok-fg">
          <CornerDownRight
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          {item.result}
        </p>
      ) : null}
      <p className="flex items-center gap-2 text-xs text-caption">
        <Avatar
          text={initials(item.requestedBy)}
          agent={item.requestedByAgent}
        />
        <span>
          Pedido por{" "}
          <span className="font-semibold text-ink-2">{item.requestedBy}</span>
          {item.roleLabel ? ` como ${item.roleLabel}` : ""} · {item.age}
        </span>
      </p>
    </li>
  );
}

function ApprovalsSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div className="h-9 w-80 rounded-full bg-off-2" />
      <div className="h-48 rounded-2xl bg-off-2" />
      <div className="h-48 rounded-2xl bg-off-2" />
    </div>
  );
}
