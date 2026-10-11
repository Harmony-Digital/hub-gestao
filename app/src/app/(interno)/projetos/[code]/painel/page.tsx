import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Avatar, Pill } from "@/components/shell/pill";
import { can } from "@/lib/authorize";
import { HubError } from "@/lib/errors";
import { formatDuration } from "@/lib/duration";
import { formatDayMonth, formatMoment, initials } from "@/lib/format";
import { HEALTH, MILESTONE_STATUS } from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { projectChangeMarker } from "@/modules/live";
import {
  projectDashboard,
  type ProjectDashboard,
} from "@/modules/projects/dashboard";
import { LiveRefresh } from "../../../_live/live-refresh";
import { PROJECT_CODE } from "../_tasks/params";
import { ProjectHeader } from "../_tasks/project-header";

export async function generateMetadata({
  params,
}: PageProps<"/projetos/[code]/painel">): Promise<Metadata> {
  const { code } = await params;
  return { title: PROJECT_CODE.test(code) ? `${code} · Painel` : "Painel" };
}

export default function PainelPage({
  params,
}: PageProps<"/projetos/[code]/painel">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
          <div className="h-24 rounded-xl bg-off-2" />
          <div className="h-96 rounded-2xl bg-off-2" />
        </div>
      }
    >
      <DashboardView params={params} />
    </Suspense>
  );
}

async function DashboardView({
  params,
}: Pick<PageProps<"/projetos/[code]/painel">, "params">) {
  const { code } = await params;
  if (!PROJECT_CODE.test(code)) notFound();
  const { user, ctx } = await pageContext();
  let data: ProjectDashboard;
  let marker: string;
  try {
    ({ data, marker } = await inTx(ctx, async (t) => ({
      data: await projectDashboard(t, code),
      marker: await projectChangeMarker(t, code),
    })));
  } catch (err) {
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  const { project, tasks } = data;
  const total = tasks.open + tasks.done;

  return (
    <>
      <ProjectHeader
        project={project}
        active="dashboard"
        canRestore={can(user.actor, "workspace.admin")}
      />
      <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
        <LiveRefresh src={`/projetos/${code}/mudancas`} marker={marker} />
        <section aria-labelledby="painel-numeros">
          <h2 id="painel-numeros" className="sr-only">
            Números do projeto
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Kpi
              label="Andamento"
              value={`${project.progress_pct}%`}
              note={
                total === 1
                  ? `${tasks.done} de 1 tarefa concluída`
                  : `${tasks.done} de ${total} tarefas concluídas`
              }
            />
            <Kpi
              label="Abertas"
              value={tasks.open}
              note={`${tasks.inProgress} em andamento, ${tasks.review} em revisão`}
            />
            <Kpi
              label="Bloqueadas"
              value={tasks.blocked}
              alert={tasks.blocked > 0}
            />
            <Kpi
              label="Atrasadas"
              value={tasks.late}
              alert={tasks.late > 0}
              href={
                tasks.late > 0
                  ? `/projetos/${code}/lista?prazo=atrasadas`
                  : null
              }
            />
            <Kpi
              label="Vencem em 7 dias"
              value={tasks.dueWeek}
              href={
                tasks.dueWeek > 0
                  ? `/projetos/${code}/lista?prazo=semana`
                  : null
              }
            />
            <Kpi label="Concluídas na semana" value={tasks.doneWeek} />
          </dl>
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card id="painel-saude" title="Saúde pela regra">
            <Health data={data} />
          </Card>
          <Card id="painel-marcos" title="Progresso por marco">
            <MilestoneProgress data={data} />
          </Card>
          <Card id="painel-departamentos" title="Carga por departamento">
            <DepartmentLoad data={data} />
          </Card>
          <Card id="painel-responsaveis" title="Carga por responsável">
            <AssigneeLoad data={data} />
          </Card>
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <Card id="painel-tempo" title="Tempo registrado">
            <Time data={data} />
          </Card>
          <Card id="painel-agentes" title="Agentes nos últimos 7 dias">
            <Agents data={data} />
          </Card>
        </div>
      </main>
    </>
  );
}

function Kpi({
  label,
  value,
  note,
  alert = false,
  href = null,
}: {
  label: string;
  value: number | string;
  note?: string;
  alert?: boolean;
  /** Abre a Lista já filtrada. */
  href?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-line bg-card p-4">
      <dt className="text-xs font-medium text-ink-2">{label}</dt>
      <dd
        className={`font-heading text-2xl font-semibold ${
          alert ? "text-danger-fg" : "text-navy"
        }`}
      >
        {value}
      </dd>
      {note ? <dd className="text-xs text-ink-2">{note}</dd> : null}
      {href ? (
        <dd className="text-xs">
          <Link
            href={href}
            className="font-semibold text-brand-strong hover:text-navy"
          >
            Ver na Lista
            <span className="sr-only"> as tarefas: {label.toLowerCase()}</span>
          </Link>
        </dd>
      ) : null}
    </div>
  );
}

function Card({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <h2 id={id} className="font-heading text-lg font-semibold text-navy">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-2">{children}</p>;
}

/** Barra com o valor escrito ao lado; a barra é só desenho. */
function Bar({ pct, tone = "bg-brand" }: { pct: number; tone?: string }) {
  const width = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <span
      aria-hidden="true"
      className="block h-2 w-full overflow-hidden rounded-full bg-off-2"
    >
      <span
        className={`block h-full rounded-full ${tone}`}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

function Health({ data }: { data: ProjectDashboard }) {
  const { health, dependencyAlerts } = data;
  const label = HEALTH[health.health];
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={label.tone}>{label.label}</Pill>
        {health.stored_health !== health.health ? (
          <span className="text-xs text-ink-2">
            O selo do topo acompanha em até 15 minutos.
          </span>
        ) : null}
      </div>
      {health.reasons.length === 0 ? (
        <Empty>
          Nenhum sinal de risco: nenhum marco atrasado, poucos bloqueios e
          nenhuma frente começada antes da frente de que depende.
        </Empty>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-ink">
          {health.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {dependencyAlerts.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {dependencyAlerts.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-1.5 text-xs font-medium text-warn-fg"
            >
              <TriangleAlert
                aria-hidden="true"
                className="mt-px size-3.5 shrink-0"
              />
              “{a.title}” começou antes de{" "}
              {a.waitingOn.map((w) => `“${w.title}”`).join(" e ")}{" "}
              {a.waitingOn.length === 1 ? "terminar" : "terminarem"}.
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-ink-2">
        Regra em código: marco atrasado, mais de 25% das tarefas abertas
        bloqueadas ou dependência quebrada deixam o projeto em risco; de 10% a
        25% bloqueadas ou aprovação esperando há mais de 3 dias úteis pedem
        atenção.
      </p>
    </div>
  );
}

function MilestoneProgress({ data }: { data: ProjectDashboard }) {
  if (data.milestones.length === 0) {
    return <Empty>Nenhum marco cadastrado.</Empty>;
  }
  // Os aceitos já fecharam: ficam recolhidos no fim, e os outros aparecem primeiro.
  const open = data.milestones.filter((m) => m.status !== "accepted");
  const accepted = data.milestones.filter((m) => m.status === "accepted");
  return (
    <div className="flex flex-col gap-3">
      {open.length > 0 ? (
        <MilestoneList milestones={open} />
      ) : (
        <Empty>Todos os marcos foram aceitos.</Empty>
      )}
      {accepted.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-ink-2">
            {accepted.length === 1
              ? "1 marco aceito"
              : `${accepted.length} marcos aceitos`}
          </summary>
          <div className="mt-3">
            <MilestoneList milestones={accepted} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function MilestoneList({
  milestones,
}: {
  milestones: ProjectDashboard["milestones"];
}) {
  return (
    <ul className="flex flex-col gap-3">
      {milestones.map((m) => {
        const status = m.late
          ? { label: "Atrasado", tone: "danger" as const }
          : MILESTONE_STATUS[m.status];
        return (
          <li key={m.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span className="font-mono text-xs font-semibold text-ink-2">
                {m.code}
              </span>
              <span className="min-w-0 flex-1 font-medium text-navy">
                {m.title}
              </span>
              <Pill tone={status.tone}>{status.label}</Pill>
            </div>
            <Bar pct={m.progress_pct} />
            <p className="text-xs text-ink-2">
              {m.progress_pct}%
              {m.task_count > 0
                ? ` · ${m.done_count} de ${m.task_count} tarefas`
                : " · sem tarefas"}
              {m.due_date ? ` · até ${formatDayMonth(m.due_date)}` : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function DepartmentLoad({ data }: { data: ProjectDashboard }) {
  if (data.departments.length === 0) {
    return <Empty>Nenhuma tarefa aberta nem concluída nesta semana.</Empty>;
  }
  const most = Math.max(1, ...data.departments.map((d) => d.open));
  return (
    <ul className="flex flex-col gap-3">
      {data.departments.map((d) => (
        <li key={d.slug ?? "sem"} className="flex flex-col gap-1.5 text-sm">
          <span className="flex items-center gap-2 font-medium text-navy">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full bg-mist"
              style={d.color ? { background: d.color } : undefined}
            />
            {d.name}
          </span>
          <Bar pct={(d.open / most) * 100} />
          <p className="text-xs text-ink-2">
            {d.open === 1 ? "1 aberta" : `${d.open} abertas`} · {d.inProgress}{" "}
            em andamento ·{" "}
            <span
              className={d.blocked > 0 ? "font-semibold text-danger-fg" : ""}
            >
              {d.blocked === 1 ? "1 bloqueada" : `${d.blocked} bloqueadas`}
            </span>{" "}
            ·{" "}
            {d.doneWeek === 1
              ? "1 concluída na semana"
              : `${d.doneWeek} concluídas na semana`}
          </p>
        </li>
      ))}
    </ul>
  );
}

function AssigneeLoad({ data }: { data: ProjectDashboard }) {
  const { assignees, tasks } = data;
  if (assignees.length === 0 && tasks.unassigned === 0) {
    return <Empty>Nenhuma tarefa aberta.</Empty>;
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      {assignees.length > 0 ? (
        <ul className="divide-y divide-line">
          {assignees.map((a) => (
            <li
              key={`${a.who.type}:${a.who.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Avatar
                  text={initials(a.who.name)}
                  agent={a.who.type === "agent"}
                />
                <span className="truncate text-ink">
                  {a.who.name ?? "Sem nome"}
                  {a.who.type === "agent" ? (
                    <span className="text-ink-2"> · agente</span>
                  ) : null}
                </span>
              </span>
              <span className="text-xs text-ink-2">
                {a.open === 1 ? "1 aberta" : `${a.open} abertas`} ·{" "}
                {a.inProgress} em andamento
                {a.blocked > 0 ? ` · ${a.blocked} bloqueadas` : ""}
                {a.late > 0 ? (
                  <span className="font-semibold text-danger-fg">
                    {" "}
                    · {a.late === 1 ? "1 atrasada" : `${a.late} atrasadas`}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {tasks.unassigned > 0 ? (
        <p className="text-xs text-ink-2">
          {tasks.unassigned === 1
            ? "1 tarefa aberta sem responsável."
            : `${tasks.unassigned} tarefas abertas sem responsável.`}{" "}
          <Link
            href={`/projetos/${data.project.code}/lista?resp=nenhum`}
            className="font-semibold text-brand-strong hover:text-navy"
          >
            Ver na Lista
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function Time({ data }: { data: ProjectDashboard }) {
  const { time, project } = data;
  if (time.total_minutes === 0 && time.ai_cost_usd.total === 0) {
    return (
      <Empty>
        Nenhum tempo registrado ainda. Pessoas lançam no painel da tarefa; os
        agentes, pela API ou pelo MCP.
      </Empty>
    );
  }
  const { estimate } = time;
  const usd = (value: number) =>
    `US$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink">
        {formatDuration(time.month_minutes)} no mês ·{" "}
        {formatDuration(time.total_minutes)} no total
      </p>
      {time.ai_cost_usd.total > 0 ? (
        <p className="text-xs text-ink-2">
          IA dos agentes do Hub neste projeto: {usd(time.ai_cost_usd.month)} no
          mês, {usd(time.ai_cost_usd.total)} no total.
        </p>
      ) : null}
      <ul className="divide-y divide-line">
        {time.by_actor.slice(0, 5).map((a) => (
          <li
            key={`${a.actor.type}:${a.actor.id}`}
            className="flex items-center gap-2 py-2"
          >
            <Avatar
              text={initials(a.actor.name)}
              agent={a.actor.type === "agent"}
            />
            <span className="min-w-0 flex-1 truncate text-ink">
              {a.actor.name ?? "Sem nome"}
            </span>
            <span className="text-xs text-ink-2">
              {formatDuration(a.month_minutes)} no mês ·{" "}
              {formatDuration(a.minutes)} no total
            </span>
          </li>
        ))}
      </ul>
      {estimate.tasks > 0 ? (
        <p className="text-xs text-ink-2">
          Nas{" "}
          {estimate.tasks === 1
            ? "1 tarefa com estimativa"
            : `${estimate.tasks} tarefas com estimativa`}
          : {formatDuration(estimate.estimated_minutes)} estimadas,{" "}
          {formatDuration(estimate.actual_minutes)} registradas.
        </p>
      ) : (
        <p className="text-xs text-ink-2">
          Nenhuma tarefa com estimativa e tempo registrado: a estimativa fica no
          painel da tarefa.
        </p>
      )}
      {time.overruns.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-ink-2">
            Acima da estimativa
          </h3>
          <ul className="flex flex-col gap-1">
            {time.overruns.slice(0, 5).map((o) => (
              <li
                key={o.code}
                className="flex flex-wrap items-baseline gap-x-2"
              >
                <Link
                  href={`/projetos/${project.code}/lista?tarefa=${o.code}`}
                  className="font-mono text-xs font-semibold text-brand-strong hover:text-navy"
                >
                  {o.code}
                </Link>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {o.title}
                </span>
                <span className="text-xs font-semibold text-danger-fg">
                  {formatDuration(o.actual_minutes)} de{" "}
                  {formatDuration(o.estimate_minutes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Agents({ data }: { data: ProjectDashboard }) {
  const { agents } = data;
  if (agents.byAgent.length === 0 && agents.recent.length === 0) {
    return (
      <Empty>
        Nenhum agente mexeu neste projeto ainda. O que eles fizerem aparece aqui
        e na Sala de Controle.
      </Empty>
    );
  }
  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-ink">
          {agents.actionsWeek === 1
            ? "1 ação na semana"
            : `${agents.actionsWeek} ações na semana`}
        </p>
        {agents.byAgent.length > 0 ? (
          <ul className="divide-y divide-line">
            {agents.byAgent.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2">
                <Avatar text={initials(a.name)} agent />
                <span className="min-w-0 flex-1 truncate text-ink">
                  {a.name}
                </span>
                <span className="text-xs text-ink-2">
                  {a.actions === 1 ? "1 ação" : `${a.actions} ações`} · última{" "}
                  {formatMoment(a.lastAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Nenhuma ação nos últimos 7 dias.</Empty>
        )}
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <h3 className="text-xs font-medium text-ink-2">Mais recentes</h3>
        <ul className="divide-y divide-line">
          {agents.recent.map((r, i) => (
            <li
              key={`${r.at}-${i}`}
              className="flex flex-wrap items-baseline gap-x-2 py-2"
            >
              <span className="font-medium text-navy">{r.agent}</span>
              <span className="min-w-0 flex-1 text-ink">{r.text}</span>
              <span className="text-xs text-ink-2">{formatMoment(r.at)}</span>
            </li>
          ))}
        </ul>
        <Link
          href={`/agentes?projeto=${data.project.code}`}
          className="self-start text-xs font-semibold text-brand-strong hover:text-navy"
        >
          Ver tudo na Sala de Controle
        </Link>
      </div>
    </div>
  );
}
