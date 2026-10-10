import Link from "next/link";
import type { ReactNode } from "react";
import { LayoutDashboard, List } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, Pill, Progress } from "@/components/shell/pill";
import { initials } from "@/lib/format";
import { HEALTH, PHASES, PROJECT_STATUS } from "@/lib/labels";
import type { ProjectDetail } from "@/modules/projects/schemas";

export type ProjectTab = "overview" | "list";

const TABS = [
  { key: "overview", label: "Visão geral", path: "", icon: LayoutDashboard },
  { key: "list", label: "Lista", path: "/lista", icon: List },
] as const;

/** Topo das telas de um projeto: identificação, saúde, fase e as abas de visão. */
export function ProjectHeader({
  project: p,
  active,
  actions,
  showObjective = false,
}: {
  project: ProjectDetail;
  active: ProjectTab;
  actions?: ReactNode;
  /** O objetivo aparece na visão geral; nas outras abas o espaço é das tarefas. */
  showObjective?: boolean;
}) {
  const health = HEALTH[p.health];
  const reasons = Array.isArray(p.health_reason.reasons)
    ? (p.health_reason.reasons as unknown[]).filter(
        (r): r is string => typeof r === "string",
      )
    : [];

  return (
    <PageHeader
      trail={[{ label: "Projetos", href: "/projetos" }, { label: p.name }]}
      title={
        <span className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-navy px-2.5 py-1 font-mono text-sm text-off">
            {p.code}
          </span>
          {p.name}
        </span>
      }
      description={
        showObjective ? (p.objective_internal ?? undefined) : undefined
      }
      actions={actions}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <span className="flex items-center gap-2">
          <Pill tone={health.tone}>{health.label}</Pill>
          {reasons[0] ? (
            <span className="text-caption">{reasons[0]}</span>
          ) : null}
        </span>
        <Pill tone={PROJECT_STATUS[p.status].tone}>
          {PROJECT_STATUS[p.status].label}
        </Pill>
        <PhaseSteps phase={p.phase} />
        <span className="text-caption">
          Cliente: <span className="text-ink">{p.client.name}</span>
        </span>
        {p.pm_agent ? (
          <span className="flex items-center gap-1.5 text-caption">
            Gestão:
            <Avatar text={initials(p.pm_agent.name)} agent />
            <span className="text-ink">{p.pm_agent.name}</span>
          </span>
        ) : null}
        {p.owner ? (
          <span className="flex items-center gap-1.5 text-caption">
            Responsável:
            <Avatar text={initials(p.owner.name)} />
            <span className="text-ink">{p.owner.name}</span>
          </span>
        ) : null}
        <Progress value={p.progress_pct} label="Progresso do projeto" />
      </div>

      <nav
        aria-label="Visões do projeto"
        className="-mb-5 flex gap-1 overflow-x-auto"
      >
        {TABS.map((tab) => {
          const current = tab.key === active;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={`/projetos/${p.code}${tab.path}`}
              aria-current={current ? "page" : undefined}
              className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors ${
                current
                  ? "border-brand text-navy"
                  : "border-transparent text-caption hover:border-line hover:text-navy"
              }`}
            >
              <Icon aria-hidden="true" className="size-4" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </PageHeader>
  );
}

function PhaseSteps({ phase }: { phase: string }) {
  const index = PHASES.findIndex((p) => p.key === phase);
  return (
    <ol aria-label="Fase do projeto" className="flex items-center gap-1">
      {PHASES.map((p, i) => (
        <li
          key={p.key}
          aria-current={i === index ? "step" : undefined}
          className={`rounded-full px-2.5 py-0.5 text-xs ${
            i === index
              ? "bg-brand font-semibold text-navy"
              : i < index
                ? "bg-off-2 text-ink-2"
                : "border border-line text-caption"
          }`}
        >
          {p.label}
        </li>
      ))}
    </ol>
  );
}
