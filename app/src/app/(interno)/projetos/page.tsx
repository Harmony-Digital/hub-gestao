import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Building2, LayoutTemplate, Plus } from "lucide-react";
import { ActivityExportForm } from "@/components/activity-export-form";
import { PageHeader } from "@/components/shell/page-header";
import { Pill, Progress } from "@/components/shell/pill";
import { formatDayMonth, formatTimestampDay } from "@/lib/format";
import { HEALTH, PHASES, PROJECT_STATUS } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/authorize";
import { pageContext } from "@/lib/ui-context";
import { archivedProjects } from "@/modules/archive/service";
import { inTx, maybeOne } from "@/modules/context";
import {
  listProjectsBoard,
  type ProjectBoardRow,
} from "@/modules/projects/overview";
import { ArchivedSection, archivedWhen } from "../_archive/archived-section";

export const metadata: Metadata = { title: "Projetos" };

const FILTERS = [
  { key: "todos", label: "Todos" },
  { key: "at_risk", label: "Em risco" },
  { key: "attention", label: "Atenção" },
  { key: "healthy", label: "Saudáveis" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

export default function ProjetosPage({ searchParams }: PageProps<"/projetos">) {
  return (
    <>
      <PageHeader
        trail={[{ label: "Projetos" }]}
        title="Projetos"
        description="A saúde de cada projeto é calculada por regra, não por opinião: marco atrasado, bloqueios e aprovações paradas."
        actions={
          <Suspense fallback={null}>
            <ProjectsActions />
          </Suspense>
        }
      />
      <main className="flex w-full flex-col gap-5 px-4 py-6 sm:px-8">
        <Suspense fallback={<BoardSkeleton />}>
          <ProjectsBoard searchParams={searchParams} />
        </Suspense>
      </main>
    </>
  );
}

/** Clientes para todos; Novo projeto só para quem administra o workspace. */
async function ProjectsActions() {
  const { user } = await pageContext();
  return (
    <>
      <Button asChild variant="outline" size="lg">
        <Link href="/clientes">
          <Building2 aria-hidden="true" />
          Clientes
        </Link>
      </Button>
      {can(user.actor, "workspace.admin") ? (
        <>
          <Button asChild variant="outline" size="lg">
            <Link href="/modelos">
              <LayoutTemplate aria-hidden="true" />
              Modelos
            </Link>
          </Button>
          <Button asChild size="lg">
            <Link href="/projetos/novo">
              <Plus aria-hidden="true" />
              Novo projeto
            </Link>
          </Button>
        </>
      ) : null}
    </>
  );
}

async function ProjectsBoard({
  searchParams,
}: Pick<PageProps<"/projetos">, "searchParams">) {
  const params = await searchParams;
  const raw = Array.isArray(params.saude) ? params.saude[0] : params.saude;
  const filter: FilterKey = FILTERS.some((f) => f.key === raw)
    ? (raw as FilterKey)
    : "todos";

  const { user, ctx } = await pageContext();
  const { rows, archived, today } = await inTx(ctx, async (t) => ({
    rows: await listProjectsBoard(t),
    archived: await archivedProjects(t),
    today: (await maybeOne<{ today: string }>(
      t,
      "select current_date::text as today",
    ))!.today,
  }));
  const count = (key: FilterKey) =>
    key === "todos" ? rows.length : rows.filter((r) => r.health === key).length;
  const visible =
    filter === "todos" ? rows : rows.filter((r) => r.health === filter);

  return (
    <>
      <nav aria-label="Filtrar por saúde" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <Link
              key={f.key}
              href={
                f.key === "todos" ? "/projetos" : `/projetos?saude=${f.key}`
              }
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors ${
                active
                  ? "border-navy bg-navy text-off"
                  : "border-line bg-paper text-ink-2 hover:border-mist hover:text-navy"
              }`}
            >
              {f.label}
              <span className="font-mono text-xs opacity-80">
                {count(f.key)}
              </span>
            </Link>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-ink-2">
          {rows.length === 0
            ? "Nenhum projeto cadastrado ainda. Os projetos reais entram pela importação do Kratos (M5)."
            : "Nenhum projeto com essa saúde agora."}
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-card md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Projetos do workspace</caption>
              <thead className="border-b border-line text-xs text-caption">
                <tr>
                  <th className="px-4 py-3 font-medium">Código</th>
                  <th className="px-4 py-3 font-medium">Projeto</th>
                  <th className="px-4 py-3 font-medium">Fase</th>
                  <th className="px-4 py-3 font-medium">Saúde</th>
                  <th className="px-4 py-3 font-medium">Próximo marco</th>
                  <th className="px-4 py-3 font-medium">Progresso</th>
                  <th className="px-4 py-3 font-medium">Tarefas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((p) => (
                  <ProjectRow key={p.id} project={p} />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-3 md:hidden">
            {visible.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </ul>
        </>
      )}

      <ArchivedSection label="Projetos arquivados" count={archived.length}>
        {archived.map((p) => (
          <li key={p.code}>
            <Link
              href={`/projetos/${p.code}`}
              prefetch={false}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm hover:bg-off"
            >
              <span className="w-14 font-mono text-xs font-semibold text-caption">
                {p.code}
              </span>
              <span className="min-w-40 flex-1 text-ink">{p.name}</span>
              <span className="text-xs text-caption">
                {archivedWhen(
                  "arquivado",
                  formatTimestampDay(p.archived_at),
                  p.client_name,
                )}
              </span>
            </Link>
          </li>
        ))}
      </ArchivedSection>

      {can(user.actor, "workspace.admin") ? (
        <details className="rounded-2xl border border-line bg-card p-4 sm:p-5">
          <summary className="cursor-pointer font-heading text-base font-semibold text-navy">
            Exportar a atividade de todos os projetos
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm text-ink-2">
              O registro de tudo o que pessoas e agentes fizeram no período, em
              todos os projetos e no workspace. Para um projeto só, use o Painel
              dele.
            </p>
            <ActivityExportForm project={null} today={today} />
          </div>
        </details>
      ) : null}
    </>
  );
}

function phaseLabel(phase: string): string {
  return PHASES.find((p) => p.key === phase)?.label ?? phase;
}

function NextMilestone({
  milestone,
}: {
  milestone: ProjectBoardRow["next_milestone"];
}) {
  if (!milestone) return <span className="text-caption">Sem marco aberto</span>;
  return (
    <span className="flex flex-col">
      <span className="text-ink">
        <span className="font-mono text-xs text-caption">{milestone.code}</span>{" "}
        {milestone.title}
      </span>
      {milestone.due_date ? (
        <span
          className={`text-xs ${milestone.late ? "font-semibold text-danger-fg" : "text-caption"}`}
        >
          {milestone.late ? "Atrasado · era " : "Previsto para "}
          {formatDayMonth(milestone.due_date)}
        </span>
      ) : null}
    </span>
  );
}

function ProjectRow({ project: p }: { project: ProjectBoardRow }) {
  const health = HEALTH[p.health];
  return (
    <tr className="align-top hover:bg-off/60">
      <td className="px-4 py-3">
        <Link
          href={`/projetos/${p.code}`}
          className="font-mono text-xs font-semibold text-navy underline-offset-4 hover:underline"
        >
          {p.code}
        </Link>
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/projetos/${p.code}`}
          className="font-semibold text-navy underline-offset-4 hover:underline"
        >
          {p.name}
        </Link>
        <span className="block text-xs text-caption">
          {p.client.name} · {PROJECT_STATUS[p.status].label}
        </span>
      </td>
      <td className="px-4 py-3 text-ink-2">{phaseLabel(p.phase)}</td>
      <td className="px-4 py-3">
        <Pill tone={health.tone}>{health.label}</Pill>
        {p.health_reasons[0] ? (
          <span className="mt-1 block max-w-56 text-xs text-caption">
            {p.health_reasons[0]}
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <NextMilestone milestone={p.next_milestone} />
      </td>
      <td className="px-4 py-3">
        <Progress value={p.progress_pct} label={`Progresso de ${p.name}`} />
      </td>
      <td className="px-4 py-3 text-xs whitespace-nowrap text-ink-2">
        {p.open_task_count} {p.open_task_count === 1 ? "aberta" : "abertas"}
        {p.blocked_task_count > 0 ? (
          <span className="block font-semibold text-danger-fg">
            {p.blocked_task_count}{" "}
            {p.blocked_task_count === 1 ? "bloqueada" : "bloqueadas"}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function ProjectCard({ project: p }: { project: ProjectBoardRow }) {
  const health = HEALTH[p.health];
  return (
    <li>
      <Link
        href={`/projetos/${p.code}`}
        className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-caption">
            {p.code}
          </span>
          <Pill tone={health.tone} className="ml-auto">
            {health.label}
          </Pill>
        </span>
        <span className="font-heading font-semibold text-navy">{p.name}</span>
        <span className="text-xs text-caption">
          {p.client.name} · {phaseLabel(p.phase)}
        </span>
        <Progress value={p.progress_pct} label={`Progresso de ${p.name}`} />
        <span className="text-sm">
          <NextMilestone milestone={p.next_milestone} />
        </span>
      </Link>
    </li>
  );
}

function BoardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div className="h-9 w-80 rounded-full bg-off-2" />
      <div className="h-64 rounded-xl bg-off-2" />
    </div>
  );
}
