import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import {
  ArrowUpRight,
  Ban,
  CircleCheck,
  CircleDashed,
  CirclePause,
  Clock3,
  Hand,
  ListChecks,
  TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Pill } from "@/components/shell/pill";
import {
  formatDayMonth,
  formatLongDate,
  formatMoment,
  greetingFor,
  todayKey,
} from "@/lib/format";
import {
  AGENT_ROLE,
  HEALTH,
  PRIORITY,
  STATUS_CATEGORY_TONE,
} from "@/lib/labels";
import { roadmap, statusLabel, type MilestoneStatus } from "@/lib/roadmap";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import type { TaskSummary } from "@/modules/projects/schemas";
import { cockpit, type Cockpit } from "@/modules/today/cockpit";
import { DecisionList } from "./_approvals/decision-list";
import { ImportBatch } from "./_approvals/import-batch";
import { decisionView } from "./_approvals/view";

export const metadata: Metadata = { title: "Hoje" };

export default function Home() {
  return (
    <>
      {/* Todo o conteúdo depende da sessão conferida: sem acesso, nada aparece. */}
      <Suspense fallback={<TodaySkeleton />}>
        <TodayView />
      </Suspense>

      <footer className="mt-auto border-t border-line">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-5 text-sm text-caption sm:px-8">
          <span>Harmony Digital · uso interno</span>
          <span className="font-mono text-xs">
            versão {process.env.APP_VERSION ?? "local"}
          </span>
        </div>
      </footer>
    </>
  );
}

const taskHref = (t: Pick<TaskSummary, "project_code" | "code">) =>
  `/projetos/${t.project_code}/lista?${new URLSearchParams({ tarefa: t.code })}`;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

async function TodayView() {
  const { user, ctx } = await pageContext();
  const data = await inTx(ctx, (t) => cockpit(t));
  // "Esperando você" sai da lista geral de bloqueios, para não aparecer duas vezes.
  const waitingCodes = new Set(data.waiting_on_me.map((t) => t.code));
  const otherBlocked = data.blocked.filter((t) => !waitingCodes.has(t.code));
  const now = new Date();
  const today = todayKey(now);
  const firstName = user.fullName.trim().split(/\s+/)[0];
  const decisions = data.pending_approvals.map((a) => decisionView(a, now));
  // Importações de projeto (D10): com duas ou mais, o dono aprova em lote.
  const imports = data.canDecide
    ? data.pending_approvals
        .filter((a) => a.type === "import_review")
        .map((a) => decisionView(a, now))
    : [];
  const n = decisions.length;
  const summary = data.canDecide
    ? n === 0
      ? "Nada esperando por você. Os agentes seguem trabalhando."
      : `${plural(n, "decisão espera", "decisões esperam")} por você. O resto, os agentes estão tocando.`
    : n === 0
      ? "Nenhum pedido seu esperando decisão."
      : `${plural(n, "pedido seu espera", "pedidos seus esperam")} a decisão do dono do workspace.`;

  return (
    <>
      <PageHeader
        trail={[{ label: "Hoje" }]}
        eyebrow={formatLongDate(now)}
        title={`${greetingFor(now)}, ${firstName}.`}
        description={summary}
      />
      <main className="flex w-full flex-col gap-6 px-4 py-6 sm:px-8">
        <Stats data={data} />
        <ProjectsStrip projects={data.projects} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <section
              id="decisoes"
              aria-labelledby="decisoes-titulo"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col gap-1">
                <h2
                  id="decisoes-titulo"
                  className="flex items-center gap-2 font-heading text-lg font-semibold text-navy"
                >
                  {data.canDecide ? "Decisões para você" : "Seus pedidos"}
                  <span className="font-mono text-sm font-normal text-caption">
                    {n}
                  </span>
                </h2>
                <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-ink-2">
                  {data.canDecide ? (
                    <span>
                      Nada vai para o cliente, nenhum prazo muda e nenhum marco
                      é aceito sem o seu sim.
                    </span>
                  ) : null}
                  <Link
                    href="/aprovacoes"
                    className="inline-flex items-center gap-1 font-semibold text-brand-strong hover:text-navy"
                  >
                    Abrir todas as aprovações
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                  </Link>
                </p>
              </div>
              {data.canDecide ? <ImportBatch items={imports} /> : null}
              <DecisionList
                items={decisions}
                canDecide={data.canDecide}
                emptyText={
                  data.canDecide
                    ? "Tudo decidido por agora. Os agentes avisam quando surgir algo novo."
                    : "Nenhum pedido seu esperando decisão."
                }
              />
            </section>

            <Section
              title="Suas tarefas"
              icon={<ListChecks aria-hidden="true" className="size-4" />}
              count={data.my_tasks.length}
            >
              {data.my_tasks.length === 0 ? (
                <Empty>Nenhuma tarefa aberta com você.</Empty>
              ) : (
                <TaskList tasks={data.my_tasks} today={today} />
              )}
            </Section>

            <Section
              title="Prazos nos próximos 3 dias"
              icon={<Clock3 aria-hidden="true" className="size-4" />}
              count={data.due_soon.length}
            >
              {data.due_soon.length === 0 ? (
                <Empty>Nenhuma tarefa aberta vence até lá.</Empty>
              ) : (
                <TaskList tasks={data.due_soon} today={today} />
              )}
            </Section>
          </div>

          <aside className="flex min-w-0 flex-col gap-6">
            {data.waiting_on_me.length > 0 ? (
              <Section
                id="esperando-voce"
                title="Esperando você"
                icon={<Hand aria-hidden="true" className="size-4" />}
                count={data.waiting_on_me.length}
                note="Tarefas bloqueadas em que você é quem destrava."
              >
                <BlockedList tasks={data.waiting_on_me} />
              </Section>
            ) : null}
            <Section
              id="bloqueios"
              title={
                data.waiting_on_me.length > 0 ? "Outros bloqueios" : "Bloqueios"
              }
              icon={<Ban aria-hidden="true" className="size-4" />}
              count={otherBlocked.length}
              note="O que está parado e do que depende."
            >
              {otherBlocked.length === 0 ? (
                <Empty>Nada bloqueado nos seus projetos.</Empty>
              ) : (
                <BlockedList tasks={otherBlocked} />
              )}
            </Section>

            <Risks projects={data.projects} />
            <AgentFeed events={data.agentEvents} />
          </aside>
        </div>

        <Roadmap />
      </main>
    </>
  );
}

function Stats({ data }: { data: Cockpit }) {
  const by = (h: string) => data.projects.filter((p) => p.health === h).length;
  const healthy = by("healthy");
  const attention = by("attention");
  const risk = by("at_risk");
  const healthParts = [
    healthy ? plural(healthy, "saudável", "saudáveis") : null,
    attention ? `${attention} em atenção` : null,
    risk ? `${risk} em risco` : null,
  ].filter(Boolean);
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        href="/projetos"
        label="Projetos ativos"
        value={data.projects.length}
        note={
          data.projects.length === 0
            ? "Nenhum projeto ativo"
            : healthParts.join(" · ")
        }
      />
      <Stat
        href="#decisoes"
        label={data.canDecide ? "Decisões para você" : "Seus pedidos"}
        value={data.pending_approvals.length}
        note={
          data.canDecide ? "Aprovar, ajustar ou recusar" : "Esperando decisão"
        }
        accent={data.canDecide && data.pending_approvals.length > 0}
      />
      <Stat
        label="Concluídas pelos agentes hoje"
        value={data.doneByAgentsToday}
        note="Sempre com evidência anexada"
      />
      <Stat
        href="#bloqueios"
        label="Bloqueios"
        value={data.blocked.length}
        note="Nos seus projetos"
        danger={data.blocked.length > 0}
      />
    </ul>
  );
}

function Stat({
  href,
  label,
  value,
  note,
  accent = false,
  danger = false,
}: {
  href?: string;
  label: string;
  value: number;
  note: string;
  accent?: boolean;
  danger?: boolean;
}) {
  const body = (
    <>
      <span className="text-xs text-caption">{label}</span>
      <span
        className={`font-heading text-3xl font-semibold ${
          danger ? "text-danger-fg" : accent ? "text-brand-strong" : "text-navy"
        }`}
      >
        {value}
      </span>
      <span className="text-xs text-ink-2">{note}</span>
    </>
  );
  const className =
    "flex h-full flex-col gap-1 rounded-2xl border border-line bg-card p-4";
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className={`${className} transition-colors hover:border-mist`}
        >
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

function ProjectsStrip({ projects }: { projects: Cockpit["projects"] }) {
  if (projects.length === 0) return null;
  return (
    <nav aria-label="Saúde dos projetos" className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-[0.08em] text-caption uppercase">
        Saúde dos projetos
      </h2>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
        {projects.map((p) => (
          <li key={p.code} className="shrink-0">
            <Link
              href={`/projetos/${p.code}`}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-paper py-1 pr-1.5 pl-3 text-sm whitespace-nowrap text-ink transition-colors hover:border-mist"
            >
              <span className="font-mono text-xs font-semibold text-caption">
                {p.code}
              </span>
              {p.name}
              <Pill tone={HEALTH[p.health].tone}>{HEALTH[p.health].label}</Pill>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Section({
  id,
  title,
  icon,
  count,
  note,
  children,
}: {
  id?: string;
  title: string;
  icon: ReactNode;
  count?: number;
  note?: string;
  children: ReactNode;
}) {
  const headingId = `${id ?? title.toLowerCase().replace(/\W+/g, "-")}-titulo`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-0.5">
        <h2
          id={headingId}
          className="flex items-center gap-2 text-base font-semibold text-navy"
        >
          {icon}
          {title}
          {count !== undefined ? (
            <span className="font-mono text-sm font-normal text-caption">
              {count}
            </span>
          ) : null}
        </h2>
        {note ? <p className="text-sm text-ink-2">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Cartões de tarefa bloqueada: código, projeto, título, motivo e quem destrava. */
function BlockedList({ tasks }: { tasks: TaskSummary[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((t) => (
        <li key={t.code}>
          <Link
            href={taskHref(t)}
            prefetch={false}
            className="block rounded-xl border border-danger/30 bg-danger-soft/40 p-3 text-sm hover:border-danger/60"
          >
            <span className="font-mono text-xs font-semibold text-danger-fg">
              {t.code}
            </span>{" "}
            <span className="font-mono text-xs text-caption">
              {t.project_code}
            </span>
            <span className="mt-0.5 block font-medium text-navy">
              {t.title}
            </span>
            {t.blocked_reason ? (
              <span className="mt-1 block text-ink-2">{t.blocked_reason}</span>
            ) : null}
            {t.blocked_on?.name ? (
              <span className="mt-1 block text-xs text-caption">
                Esperando: {t.blocked_on.name}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-2">
      {children}
    </p>
  );
}

function TaskList({ tasks, today }: { tasks: TaskSummary[]; today: string }) {
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-card">
      {tasks.map((t) => {
        const late =
          t.due_date !== null &&
          t.due_date < today &&
          t.status_category !== "done";
        return (
          <li key={t.code}>
            <Link
              href={taskHref(t)}
              prefetch={false}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-off"
            >
              <span className="w-16 shrink-0 font-mono text-xs font-semibold text-caption">
                {t.code}
              </span>
              <span className="min-w-40 flex-1 text-ink">{t.title}</span>
              <span className="font-mono text-xs text-caption">
                {t.project_code}
              </span>
              {t.priority === "urgent" || t.priority === "high" ? (
                <Pill tone={PRIORITY[t.priority].tone}>
                  {PRIORITY[t.priority].label}
                </Pill>
              ) : null}
              {t.due_date ? (
                <span
                  className={`text-xs ${late ? "font-semibold text-danger-fg" : "text-caption"}`}
                >
                  {late ? "venceu " : "até "}
                  {formatDayMonth(t.due_date)}
                </span>
              ) : null}
              <Pill tone={STATUS_CATEGORY_TONE[t.status_category]}>
                {t.status_name}
              </Pill>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Risks({ projects }: { projects: Cockpit["projects"] }) {
  const flagged = projects.filter((p) => p.health !== "healthy");
  return (
    <Section
      title="Riscos"
      icon={<TriangleAlert aria-hidden="true" className="size-4" />}
      count={flagged.length}
      note="Calculados por regra: marco atrasado, bloqueios e aprovações paradas."
    >
      {flagged.length === 0 ? (
        <Empty>Nenhum projeto em risco ou em atenção agora.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {flagged.map((p) => (
            <li key={p.code}>
              <Link
                href={`/projetos/${p.code}`}
                className="flex flex-col gap-1.5 rounded-xl border border-line bg-card p-3 text-sm transition-colors hover:border-mist"
              >
                <span className="flex items-center gap-2">
                  <Pill tone={HEALTH[p.health].tone}>
                    {HEALTH[p.health].label}
                  </Pill>
                  <span className="font-mono text-xs font-semibold text-caption">
                    {p.code}
                  </span>
                  <span className="font-medium text-navy">{p.name}</span>
                </span>
                {p.reasons.length > 0 ? (
                  <span className="text-ink-2">{p.reasons.join(" ")}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** O que os agentes fizeram nas últimas 24 horas, no estilo do console (D4). */
function AgentFeed({ events }: { events: Cockpit["agentEvents"] }) {
  return (
    <section
      aria-labelledby="agentes-24h"
      className="flex flex-col gap-3 rounded-2xl bg-navy p-4 text-mist"
    >
      <h2
        id="agentes-24h"
        className="font-mono text-[11px] tracking-[0.12em] text-brand-soft uppercase"
      >
        Agentes nas últimas 24 h
      </h2>
      {events.length === 0 ? (
        <p className="text-sm">Nenhuma ação de agente nas últimas 24 horas.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {events.map((e, i) => {
            const line = (
              <>
                <span className="w-12 shrink-0 font-mono text-xs text-mist/80">
                  {formatMoment(e.at)}
                </span>
                <span className="min-w-0 text-sm leading-snug text-off/90">
                  <span className="font-semibold text-brand-soft">
                    {e.agent}
                  </span>
                  {e.role ? ` como ${AGENT_ROLE[e.role] ?? e.role}` : ""}{" "}
                  {e.text}
                  {e.projectCode ? (
                    <span className="font-mono text-xs text-mist/80">
                      {" "}
                      · {e.projectCode}
                    </span>
                  ) : null}
                </span>
              </>
            );
            return (
              <li key={`${e.at}-${i}`}>
                {e.taskCode && e.projectCode ? (
                  <Link
                    href={taskHref({
                      project_code: e.projectCode,
                      code: e.taskCode,
                    })}
                    prefetch={false}
                    className="flex gap-3 rounded-md hover:bg-navy-2"
                  >
                    {line}
                  </Link>
                ) : (
                  <div className="flex gap-3">{line}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <Link
        href="/agentes"
        className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-brand-soft hover:text-off"
      >
        Abrir a Sala de Controle
        <ArrowUpRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  );
}

const statusStyle: Record<MilestoneStatus, string> = {
  concluido: "bg-ok-soft text-ok-fg",
  "em-andamento": "bg-warn-soft text-warn-fg",
  planejado: "bg-off-2 text-ink-2",
  adiado: "bg-off-2 text-caption",
};

const statusIcon: Record<MilestoneStatus, typeof CircleCheck> = {
  concluido: CircleCheck,
  "em-andamento": Clock3,
  planejado: CircleDashed,
  adiado: CirclePause,
};

/** Etapas da construção do próprio Hub, recolhidas no fim da tela. */
function Roadmap() {
  return (
    <details className="group rounded-2xl border border-line bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-navy [&::-webkit-details-marker]:hidden">
        <ArrowUpRight
          aria-hidden="true"
          className="size-4 rotate-45 text-caption transition-transform group-open:rotate-[135deg]"
        />
        Etapas da construção do Hub
      </summary>
      <ol className="grid gap-3 border-t border-line p-4 sm:grid-cols-2">
        {roadmap.map((m) => {
          const Icon = statusIcon[m.status];
          return (
            <li
              key={m.code}
              className={`flex flex-col gap-2 rounded-xl border bg-paper p-4 ${
                m.status === "em-andamento"
                  ? "border-2 border-brand"
                  : "border-line"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-caption">
                  {m.code}
                </span>
                <span
                  className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyle[m.status]}`}
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                  {statusLabel[m.status]}
                </span>
              </div>
              <p className="font-heading text-base font-semibold text-navy">
                {m.title}
              </p>
              <p className="text-sm leading-relaxed text-ink-2">{m.summary}</p>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function TodaySkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
      <div className="h-20 w-full max-w-xl rounded-xl bg-off-2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-off-2" />
        ))}
      </div>
      <div className="h-64 rounded-2xl bg-off-2" />
    </div>
  );
}
