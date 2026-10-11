import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Link2, TriangleAlert } from "lucide-react";
import { Pill } from "@/components/shell/pill";
import { can } from "@/lib/authorize";
import { HubError } from "@/lib/errors";
import { formatDayMonth, formatDate } from "@/lib/format";
import {
  MILESTONE_STATUS,
  TONE_CLASS,
  WORKSTREAM_STATUS,
  type Tone,
} from "@/lib/labels";
import { pageContext } from "@/lib/ui-context";
import { inTx } from "@/modules/context";
import { projectTimeline } from "@/modules/projects/timeline";
import {
  barPosition,
  monthTicks,
  type TimelineBar,
} from "@/modules/projects/timeline-layout";
import { PROJECT_CODE } from "../_tasks/params";
import { ProjectHeader } from "../_tasks/project-header";

export async function generateMetadata({
  params,
}: PageProps<"/projetos/[code]/linha-do-tempo">): Promise<Metadata> {
  const { code } = await params;
  return {
    title: PROJECT_CODE.test(code)
      ? `${code} · Linha do tempo`
      : "Linha do tempo",
  };
}

const MONTHS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/** Cor da barra pelo estado: os mesmos pares dos selos (fundo e texto com contraste AA). */
const BAR_CLASS: Record<Tone, string> = TONE_CLASS;

function statusOf(bar: TimelineBar): { label: string; tone: Tone } {
  return bar.kind === "milestone"
    ? MILESTONE_STATUS[bar.status as keyof typeof MILESTONE_STATUS]
    : WORKSTREAM_STATUS[bar.status as keyof typeof WORKSTREAM_STATUS];
}

export default function LinhaDoTempoPage({
  params,
}: PageProps<"/projetos/[code]/linha-do-tempo">) {
  return (
    <Suspense
      fallback={
        <div aria-busy="true" className="flex flex-col gap-6 px-4 py-6 sm:px-8">
          <div className="h-24 rounded-xl bg-off-2" />
          <div className="h-96 rounded-2xl bg-off-2" />
        </div>
      }
    >
      <TimelineView params={params} />
    </Suspense>
  );
}

async function TimelineView({
  params,
}: Pick<PageProps<"/projetos/[code]/linha-do-tempo">, "params">) {
  const { code } = await params;
  if (!PROJECT_CODE.test(code)) notFound();
  const { user, ctx } = await pageContext();
  let data: Awaited<ReturnType<typeof projectTimeline>>;
  try {
    data = await inTx(ctx, (t) => projectTimeline(t, code));
  } catch (err) {
    if (err instanceof HubError && (err.status === 404 || err.status === 403)) {
      notFound();
    }
    throw err;
  }
  const { project, today, timeline } = data;
  const range = { start: timeline.start, end: timeline.end };
  const todayAt = barPosition(range, today, today).left;
  const ticks = monthTicks(range);
  const conflicts = timeline.bars.filter((b) => b.conflict).length;

  return (
    <>
      <ProjectHeader
        project={project}
        active="timeline"
        canRestore={can(user.actor, "workspace.admin")}
      />
      <main className="flex w-full flex-col gap-4 px-4 py-6 sm:px-8">
        <p className="text-sm text-ink-2">
          Marcos e frentes no tempo. A frente vai do primeiro ao último dia das
          tarefas dela; sem tarefa com data, segue o marco (barra tracejada).
        </p>
        {conflicts > 0 ? (
          <p className="flex items-start gap-2 rounded-xl bg-warn-soft p-3 text-sm text-warn-fg">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            {conflicts === 1
              ? "1 frente começa antes de terminar a frente de que depende."
              : `${conflicts} frentes começam antes de terminar as frentes de que dependem.`}
          </p>
        ) : null}
        {timeline.bars.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-2">
            Nenhum marco com data ainda. Com a data das entregas, a linha do
            tempo aparece aqui.
          </p>
        ) : (
          <>
            {/* Tela larga: as barras. */}
            <div className="relative hidden overflow-x-auto md:block">
              <div className="min-w-[56rem]">
                <div className="grid grid-cols-[16rem_1fr] items-end border-b border-line pb-1">
                  <span className="text-xs font-semibold tracking-[0.06em] text-caption uppercase">
                    Marco ou frente
                  </span>
                  <div aria-hidden="true" className="relative h-5">
                    {ticks.map((tick) => (
                      <span
                        key={tick}
                        className="absolute text-xs text-caption"
                        style={{
                          left: `${barPosition(range, tick, tick).left}%`,
                        }}
                      >
                        {MONTHS[Number(tick.slice(5, 7)) - 1]}
                        {tick.slice(5, 7) === "01"
                          ? ` ${tick.slice(0, 4)}`
                          : ""}
                      </span>
                    ))}
                  </div>
                </div>
                <ul aria-label="Linha do tempo" className="flex flex-col">
                  {timeline.bars.map((bar) => {
                    const pos = barPosition(range, bar.start, bar.end);
                    const status = statusOf(bar);
                    return (
                      <li
                        key={`${bar.kind}-${bar.id}`}
                        className="grid grid-cols-[16rem_1fr] items-center border-b border-line/60 py-1.5"
                      >
                        <span
                          className={`min-w-0 truncate pr-3 text-sm ${bar.kind === "milestone" ? "font-semibold text-navy" : "pl-4 text-ink"}`}
                        >
                          {bar.code ? (
                            <span className="font-mono">{bar.code} </span>
                          ) : null}
                          {bar.label}
                        </span>
                        <div className="relative h-6">
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-0 w-px bg-brand"
                            style={{ left: `${todayAt}%` }}
                          />
                          <span
                            className={`absolute inset-y-1 flex items-center rounded-md px-1.5 text-[11px] font-medium ${bar.estimated ? "border border-dashed border-ink-2 text-ink-2" : BAR_CLASS[status.tone]} ${bar.conflict ? "ring-2 ring-warn" : ""}`}
                            style={{
                              left: `${pos.left}%`,
                              width: `${pos.width}%`,
                            }}
                          >
                            <span className="sr-only">
                              {bar.code ? `${bar.code} ` : ""}
                              {bar.label}:{" "}
                            </span>
                            <span className="truncate">
                              {formatDayMonth(bar.start)} a{" "}
                              {formatDayMonth(bar.end)}
                              <span className="sr-only">
                                , {status.label}, {bar.progressPct}%
                                {bar.dependsOn.length
                                  ? `, depende de ${bar.dependsOn.join(", ")}`
                                  : ""}
                                {bar.conflict
                                  ? ", começa antes de a dependência terminar"
                                  : ""}
                              </span>
                            </span>
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* Celular: lista com as datas. */}
            <ul className="flex flex-col gap-2 md:hidden">
              {timeline.bars.map((bar) => {
                const status = statusOf(bar);
                return (
                  <li
                    key={`${bar.kind}-${bar.id}`}
                    className={`flex flex-col gap-1 rounded-xl border border-line bg-card p-3 ${bar.kind === "workstream" ? "ml-4" : ""}`}
                  >
                    <span className="flex flex-wrap items-center gap-2 text-sm">
                      <span
                        className={
                          bar.kind === "milestone"
                            ? "font-semibold text-navy"
                            : "text-ink"
                        }
                      >
                        {bar.code ? (
                          <span className="font-mono">{bar.code} </span>
                        ) : null}
                        {bar.label}
                      </span>
                      <Pill tone={status.tone}>{status.label}</Pill>
                    </span>
                    <span className="text-xs text-ink-2">
                      {formatDate(bar.start)} a {formatDate(bar.end)}
                      {bar.estimated ? " (segue o marco)" : ""} ·{" "}
                      {bar.progressPct}%
                    </span>
                    {bar.dependsOn.length ? (
                      <span
                        className={`flex items-center gap-1 text-xs ${bar.conflict ? "text-warn-fg" : "text-caption"}`}
                      >
                        <Link2 aria-hidden="true" className="size-3" />
                        Depende de {bar.dependsOn.join(", ")}
                        {bar.conflict ? " (começa antes de ela terminar)" : ""}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {timeline.undated.length > 0 ? (
          <p className="text-sm text-caption">
            Sem data, fora da linha do tempo: {timeline.undated.join("; ")}.
          </p>
        ) : null}
      </main>
    </>
  );
}
