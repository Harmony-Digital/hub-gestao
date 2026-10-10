import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Ban, Check, Eye, EyeOff, ListChecks, Lock } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, Pill, Progress } from "@/components/shell/pill";
import { HubError } from "@/lib/errors";
import {
  formatDayMonth,
  formatMoment,
  formatTimestampDay,
  initials,
} from "@/lib/format";
import {
  HEALTH,
  MILESTONE_STATUS,
  PHASES,
  PRIORITY,
  PROJECT_STATUS,
  STATUS_CATEGORY_TONE,
  WORKSTREAM_STATUS,
} from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  projectOverview,
  type ProjectOverview,
} from "@/modules/projects/overview";
import type { TaskSummary } from "@/modules/projects/schemas";

const CODE = /^[A-Z0-9]{2,8}$/;

export async function generateMetadata({
  params,
}: PageProps<"/projetos/[code]">): Promise<Metadata> {
  const { code } = await params;
  return { title: CODE.test(code) ? code : "Projeto" };
}

export default function ProjetoPage({ params }: PageProps<"/projetos/[code]">) {
  return (
    <Suspense fallback={<ProjectSkeleton />}>
      <ProjectView params={params} />
    </Suspense>
  );
}

async function ProjectView({
  params,
}: Pick<PageProps<"/projetos/[code]">, "params">) {
  const { code } = await params;
  if (!CODE.test(code)) notFound();
  const { ctx } = await pageContext();
  let data: ProjectOverview;
  try {
    data = await inTx(ctx, (t) => projectOverview(t, code));
  } catch (err) {
    // Projeto inexistente ou fora do alcance de quem vê: a mesma página de "não achei".
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  const { project: p } = data;
  const health = HEALTH[p.health];
  const reasons = Array.isArray(p.health_reason.reasons)
    ? (p.health_reason.reasons as unknown[]).filter(
        (r): r is string => typeof r === "string",
      )
    : [];

  return (
    <>
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
        description={p.objective_internal ?? undefined}
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
      </PageHeader>

      <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
        <Layer
          n={1}
          title="Estratégica"
          heading="Marcos e entregas"
          note="O cliente vê sempre"
          icon={<Eye aria-hidden="true" className="size-3.5" />}
        >
          <Milestones data={data} />
        </Layer>

        <Layer
          n={2}
          title="Tática"
          heading="Frentes por departamento"
          note="O cliente vê só as frentes marcadas"
          icon={<Eye aria-hidden="true" className="size-3.5" />}
        >
          <Workstreams data={data} />
        </Layer>

        <Layer
          n={3}
          title="Operacional"
          heading="O que está acontecendo agora"
          note="O cliente nunca vê"
          icon={<EyeOff aria-hidden="true" className="size-3.5" />}
        >
          <Operational data={data} />
        </Layer>
      </main>
    </>
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

function Layer({
  n,
  title,
  heading,
  note,
  icon,
  children,
}: {
  n: number;
  title: string;
  heading: string;
  note: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`camada-${n}`}
      className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="font-mono text-[11px] tracking-[0.12em] text-brand-strong uppercase">
            Camada {n} · {title}
          </p>
          <h2
            id={`camada-${n}`}
            className="font-heading text-lg font-semibold text-navy"
          >
            {heading}
          </h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-off-2 px-2.5 py-1 text-xs text-ink-2">
          {icon}
          {note}
        </span>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
      {children}
    </p>
  );
}

function Milestones({ data }: { data: ProjectOverview }) {
  if (data.milestones.length === 0) {
    return (
      <Empty>
        Nenhum marco cadastrado. Marcos são criados por pessoas, e o aceite é
        sempre do Fábio.
      </Empty>
    );
  }
  return (
    <ol className="flex flex-col divide-y divide-line">
      {data.milestones.map((m) => {
        const status = MILESTONE_STATUS[m.status];
        const criteriaDone = m.acceptance_criteria.filter((c) => c.done).length;
        return (
          <li
            key={m.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
          >
            <span className="w-10 font-mono text-xs font-semibold text-caption">
              {m.code}
            </span>
            <span className="min-w-48 flex-1">
              <span className="block font-semibold text-navy">{m.title}</span>
              <span className="block text-xs text-caption">
                {m.accepted_at
                  ? `Aceito em ${formatTimestampDay(m.accepted_at)}${m.accepted_by?.name ? ` por ${m.accepted_by.name}` : ""}`
                  : m.due_date
                    ? `${m.late ? "Atrasado · era " : "Previsto para "}${formatDayMonth(m.due_date)}`
                    : "Sem data"}
                {m.acceptance_criteria.length > 0
                  ? ` · critérios ${criteriaDone}/${m.acceptance_criteria.length}`
                  : ""}
                {m.visibility === "internal" ? " · interno" : ""}
              </span>
            </span>
            <Pill tone={m.late && !m.accepted_at ? "danger" : status.tone}>
              {m.late && !m.accepted_at ? "Atrasado" : status.label}
            </Pill>
            <Progress value={m.progress_pct} label={`Progresso de ${m.code}`} />
          </li>
        );
      })}
    </ol>
  );
}

function Workstreams({ data }: { data: ProjectOverview }) {
  if (data.workstreams.length === 0) {
    return (
      <Empty>
        Nenhuma frente cadastrada. Frentes organizam o trabalho por departamento
        e podem ser mostradas ao cliente, uma a uma.
      </Empty>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <caption className="sr-only">Frentes do projeto</caption>
        <thead className="text-xs text-caption">
          <tr>
            <th className="py-2 pr-3 font-medium">Departamento</th>
            <th className="py-2 pr-3 font-medium">Frente</th>
            <th className="py-2 pr-3 font-medium">Responsável</th>
            <th className="py-2 pr-3 font-medium">Progresso</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 font-medium">No portal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.workstreams.map((w) => {
            const status = WORKSTREAM_STATUS[w.status];
            return (
              <tr key={w.id} className="align-top">
                <td className="py-2.5 pr-3">
                  {w.department ? (
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 rounded-full"
                        style={{ background: w.department.color }}
                      />
                      {w.department.name}
                    </span>
                  ) : (
                    <span className="text-caption">Sem departamento</span>
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  <span className="font-medium text-navy">{w.title}</span>
                  {w.milestone ? (
                    <span className="block text-xs text-caption">
                      Marco {w.milestone.code}
                      {w.blocked_count > 0
                        ? ` · ${w.blocked_count} bloqueada(s)`
                        : ""}
                    </span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-3">
                  {w.assignee ? (
                    <span className="flex items-center gap-1.5">
                      <Avatar
                        text={initials(w.assignee.name)}
                        agent={w.assignee.type === "agent"}
                      />
                      {w.assignee.name}
                    </span>
                  ) : (
                    <span className="text-caption">Ninguém</span>
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  <Progress
                    value={w.progress_pct}
                    label={`Progresso de ${w.title}`}
                  />
                </td>
                <td className="py-2.5 pr-3">
                  <Pill tone={status.tone}>{status.label}</Pill>
                </td>
                <td className="py-2.5">
                  {w.visibility === "client" ? (
                    <span className="inline-flex items-center gap-1 text-ok-fg">
                      <Eye aria-hidden="true" className="size-4" /> Visível
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-caption">
                      <EyeOff aria-hidden="true" className="size-4" /> Interna
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({ task }: { task: TaskSummary }) {
  const priority = PRIORITY[task.priority];
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <span className="w-16 font-mono text-xs font-semibold text-caption">
        {task.code}
      </span>
      <span className="min-w-40 flex-1 text-ink">{task.title}</span>
      {task.priority === "urgent" || task.priority === "high" ? (
        <Pill tone={priority.tone}>{priority.label}</Pill>
      ) : null}
      {task.due_date ? (
        <span className="text-xs text-caption">
          até {formatDayMonth(task.due_date)}
        </span>
      ) : null}
      {task.assignee ? (
        <Avatar
          text={initials(task.assignee.name)}
          agent={task.assignee.type === "agent"}
          title={task.assignee.name ?? undefined}
        />
      ) : null}
      <Pill tone={STATUS_CATEGORY_TONE[task.status_category]}>
        {task.status_name}
      </Pill>
    </li>
  );
}

function Operational({ data }: { data: ProjectOverview }) {
  const { project: p } = data;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-navy">
            <ListChecks aria-hidden="true" className="size-4" />
            Fila de trabalho
          </h3>
          {data.queue.length === 0 ? (
            <Empty>Nenhuma tarefa aberta neste projeto.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {data.queue.map((t) => (
                <TaskRow key={t.code} task={t} />
              ))}
            </ul>
          )}
        </div>

        {data.blocked.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-danger-fg">
              <Ban aria-hidden="true" className="size-4" />
              Bloqueios
            </h3>
            <ul className="flex flex-col gap-2">
              {data.blocked.map((t) => (
                <li
                  key={t.code}
                  className="rounded-xl border border-danger/30 bg-danger-soft/40 p-3 text-sm"
                >
                  <span className="font-mono text-xs font-semibold text-danger-fg">
                    {t.code}
                  </span>{" "}
                  <span className="font-medium text-navy">{t.title}</span>
                  {t.blocked_reason ? (
                    <span className="mt-1 block text-ink-2">
                      {t.blocked_reason}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 rounded-xl bg-off p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-navy">
            <Lock aria-hidden="true" className="size-4" />
            Regras deste projeto
          </h3>
          <ul className="flex flex-col gap-1.5 text-sm text-ink-2">
            <li className="flex gap-2">
              <Check
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-ok"
              />
              {p.require_evidence
                ? "Concluir uma tarefa exige evidência."
                : "Concluir uma tarefa não exige evidência."}
            </li>
            <li className="flex gap-2">
              <Check
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-ok"
              />
              Aceite de marco: só o Fábio.
            </li>
            <li className="flex gap-2">
              <Check
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-ok"
              />
              {p.client_can_confirm_receipt
                ? "O cliente pode confirmar o recebimento das entregas."
                : "O cliente acompanha, sem confirmar recebimento."}
            </li>
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-navy">Atividade recente</h3>
          {data.activity.length === 0 ? (
            <Empty>Nada registrado ainda.</Empty>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {data.activity.map((a, i) => (
                <li key={`${a.at}-${i}`} className="flex gap-3 text-sm">
                  <span className="w-12 shrink-0 font-mono text-xs text-caption">
                    {formatMoment(a.at)}
                  </span>
                  <span className="text-ink-2">
                    <span className="font-semibold text-navy">
                      {a.actor?.name ?? "Hub"}
                    </span>{" "}
                    {a.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
      <div className="h-24 rounded-xl bg-off-2" />
      <div className="h-48 rounded-2xl bg-off-2" />
      <div className="h-48 rounded-2xl bg-off-2" />
    </div>
  );
}
