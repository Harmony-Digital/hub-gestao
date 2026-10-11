import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { Pill } from "@/components/shell/pill";
import { can } from "@/lib/authorize";
import { HubError } from "@/lib/errors";
import { formatDate, todayKey } from "@/lib/format";
import { MILESTONE_STATUS, STATUS_CATEGORY_TONE } from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import {
  projectCalendar,
  type CalendarEntry,
  type ProjectCalendar,
} from "@/modules/projects/calendar";
import {
  monthLabel,
  monthWeeks,
  readMonth,
  shiftMonth,
} from "@/modules/projects/calendar-grid";
import { STATUS_CATEGORY_LABEL } from "@/modules/tasks/status-categories";
import { PROJECT_CODE } from "../_tasks/params";
import { ProjectHeader } from "../_tasks/project-header";

export async function generateMetadata({
  params,
}: PageProps<"/projetos/[code]/calendario">): Promise<Metadata> {
  const { code } = await params;
  return {
    title: PROJECT_CODE.test(code) ? `${code} · Calendário` : "Calendário",
  };
}

const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const WEEKDAY_NAMES = [
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
  "domingo",
];
/** Itens por dia na grade; o resto vira "+N". */
const PER_DAY = 4;

export default function CalendarioPage({
  params,
  searchParams,
}: PageProps<"/projetos/[code]/calendario">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
          <div className="h-24 rounded-xl bg-off-2" />
          <div className="h-96 rounded-2xl bg-off-2" />
        </div>
      }
    >
      <CalendarView params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function CalendarView({
  params,
  searchParams,
}: PageProps<"/projetos/[code]/calendario">) {
  const { code } = await params;
  if (!PROJECT_CODE.test(code)) notFound();
  const query = await searchParams;
  const { user, ctx } = await pageContext();
  // O mês sai do endereço; sem ele, o mês de hoje em Brasília (D2).
  const month = readMonth(
    Array.isArray(query.mes) ? query.mes[0] : query.mes,
    todayKey(new Date()),
  );
  const weeks = monthWeeks(month);
  let data: ProjectCalendar;
  try {
    data = await inTx(ctx, (t) =>
      projectCalendar(t, code, {
        from: weeks[0][0],
        to: weeks[weeks.length - 1][6],
      }),
    );
  } catch (err) {
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of data.entries) {
    byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  }
  const base = `/projetos/${code}/calendario`;
  const monthDays = weeks.flat().filter((d) => d.startsWith(month));

  return (
    <>
      <ProjectHeader
        project={data.project}
        active="calendar"
        canRestore={can(user.actor, "workspace.admin")}
      />
      <main className="flex w-full flex-col gap-4 px-4 py-6 sm:px-8">
        <nav
          aria-label="Mês do calendário"
          className="flex flex-wrap items-center gap-2"
        >
          <Link
            href={`${base}?mes=${shiftMonth(month, -1)}`}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-card text-navy hover:bg-off"
            aria-label={`Mês anterior: ${monthLabel(shiftMonth(month, -1))}`}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Link>
          <Link
            href={`${base}?mes=${shiftMonth(month, 1)}`}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-card text-navy hover:bg-off"
            aria-label={`Próximo mês: ${monthLabel(shiftMonth(month, 1))}`}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
          <h2 className="font-heading text-lg font-semibold text-navy first-letter:uppercase">
            {monthLabel(month)}
          </h2>
          {month !== data.today.slice(0, 7) ? (
            <Link
              href={base}
              className="ml-2 text-sm font-semibold text-brand-strong hover:text-navy"
            >
              Ir para hoje
            </Link>
          ) : null}
        </nav>

        {/* Tela larga: a grade do mês. */}
        <div className="relative hidden overflow-x-auto md:block">
          <table className="w-full min-w-[56rem] table-fixed border-collapse">
            <caption className="sr-only">
              Entregas e prazos de {data.project.name} em {monthLabel(month)}
            </caption>
            <thead>
              <tr>
                {WEEKDAYS.map((d, i) => (
                  <th
                    key={d}
                    scope="col"
                    abbr={WEEKDAY_NAMES[i]}
                    className="px-2 pb-1 text-left text-xs font-semibold tracking-[0.06em] text-caption uppercase"
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]}>
                  {week.map((day) => {
                    const items = byDay.get(day) ?? [];
                    const outside = !day.startsWith(month);
                    const today = day === data.today;
                    return (
                      <td
                        key={day}
                        className={`h-28 border border-line p-1.5 align-top ${outside ? "bg-off" : "bg-card"}`}
                      >
                        <div
                          className={`mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs ${today ? "bg-navy font-semibold text-off" : outside ? "text-caption" : "text-ink-2"}`}
                        >
                          <span className="sr-only">{formatDate(day)}</span>
                          <span aria-hidden="true">
                            {Number(day.slice(8, 10))}
                          </span>
                        </div>
                        <ul className="flex flex-col gap-1">
                          {items.slice(0, PER_DAY).map((e) => (
                            <EntryItem
                              key={`${e.kind}-${e.code}`}
                              entry={e}
                              projectCode={code}
                              compact
                            />
                          ))}
                          {items.length > PER_DAY ? (
                            <li className="px-1 text-xs text-caption">
                              mais {items.length - PER_DAY}
                            </li>
                          ) : null}
                        </ul>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Celular: só os dias do mês com entrega ou prazo. */}
        <div className="flex flex-col gap-3 md:hidden">
          {monthDays.filter((d) => byDay.has(d)).length === 0 ? (
            <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-2">
              Nenhuma entrega nem prazo em {monthLabel(month)}.
            </p>
          ) : (
            monthDays
              .filter((d) => byDay.has(d))
              .map((day) => (
                <section
                  key={day}
                  aria-label={formatDate(day)}
                  className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-3"
                >
                  <p className="text-sm font-semibold text-navy">
                    {formatDate(day)}
                    {day === data.today ? " · hoje" : ""}
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {byDay.get(day)!.map((e) => (
                      <EntryItem
                        key={`${e.kind}-${e.code}`}
                        entry={e}
                        projectCode={code}
                      />
                    ))}
                  </ul>
                </section>
              ))
          )}
        </div>
      </main>
    </>
  );
}

function EntryItem({
  entry: e,
  projectCode,
  compact = false,
}: {
  entry: CalendarEntry;
  projectCode: string;
  compact?: boolean;
}) {
  if (e.kind === "milestone") {
    const status = MILESTONE_STATUS[e.status];
    return (
      <li>
        <Link
          href={`/projetos/${projectCode}`}
          className="flex items-start gap-1 rounded-md bg-brand-soft/20 px-1.5 py-1 text-xs text-navy hover:bg-brand-soft/40"
        >
          <Flag
            aria-hidden="true"
            className="mt-0.5 size-3 shrink-0 text-brand-strong"
          />
          <span
            className={`min-w-0 ${compact ? "line-clamp-2" : ""} break-words`}
          >
            <span className="font-mono font-semibold">{e.code}</span> {e.title}
            <span className="sr-only">
              {" "}
              (entrega, {status.label}
              {e.internal ? ", interna" : ""})
            </span>
          </span>
          {compact ? null : <Pill tone={status.tone}>{status.label}</Pill>}
        </Link>
      </li>
    );
  }
  const done = e.category === "done";
  return (
    <li>
      <Link
        href={`/projetos/${projectCode}?tarefa=${e.code}`}
        prefetch={false}
        className={`flex items-start gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-off ${done ? "text-caption line-through" : "text-ink"}`}
      >
        <span
          className={`min-w-0 ${compact ? "line-clamp-2" : ""} break-words`}
        >
          <span className="font-mono">{e.code}</span> {e.title}
          <span className="sr-only">
            {" "}
            (tarefa, {STATUS_CATEGORY_LABEL[e.category]}
            {e.assignee ? `, com ${e.assignee}` : ""})
          </span>
        </span>
        {compact ? null : (
          <Pill tone={STATUS_CATEGORY_TONE[e.category]}>
            {STATUS_CATEGORY_LABEL[e.category]}
          </Pill>
        )}
      </Link>
    </li>
  );
}
