/**
 * Linha do tempo do projeto (M7), a parte pura: as datas de cada barra (marco e frente),
 * o intervalo do gráfico e a posição de cada barra em porcentagem. Datas puras
 * (AAAA-MM-DD), sem fuso. Vale na tela e nos testes.
 */

export type TimelineMilestoneIn = {
  id: string;
  code: string;
  title: string;
  status: "planned" | "in_progress" | "delivered" | "accepted";
  dueDate: string | null;
  deliveredOn: string | null;
  progressPct: number;
};

export type TimelineWorkstreamIn = {
  id: string;
  milestoneId: string | null;
  title: string;
  status: "planned" | "in_progress" | "blocked" | "done";
  progressPct: number;
  /** Primeiro e último dia das tarefas da frente (início ou criação; prazo ou conclusão). */
  firstDay: string | null;
  lastDay: string | null;
  dependsOn: string[];
};

export type TimelineBar = {
  kind: "milestone" | "workstream";
  id: string;
  label: string;
  code: string | null;
  start: string;
  end: string;
  /** Sem data própria: a barra segue o marco (frente sem tarefas datadas). */
  estimated: boolean;
  status: string;
  progressPct: number;
  /** Frentes de que esta depende (títulos). */
  dependsOn: string[];
  /** Depende de frente não concluída que termina depois de esta começar. */
  conflict: boolean;
};

export type Timeline = {
  start: string;
  end: string;
  bars: TimelineBar[];
  /** Marcos sem data, que não entram no gráfico. */
  undated: string[];
};

const DAY = 86_400_000;
const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toDay(toTime(d) + n * DAY);
const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);

/** Marcos em ordem, com as frentes de cada um logo abaixo; datas e alertas calculados. */
export function buildTimeline(input: {
  today: string;
  projectStart: string | null;
  projectEnd: string | null;
  milestones: TimelineMilestoneIn[];
  workstreams: TimelineWorkstreamIn[];
}): Timeline {
  const bars: TimelineBar[] = [];
  const undated: string[] = [];
  const wsEnd = new Map<
    string,
    { end: string; done: boolean; title: string }
  >();
  let previousEnd: string | null = null;

  const msRange = new Map<string, { start: string; end: string }>();
  for (const m of input.milestones) {
    const end = m.dueDate ?? m.deliveredOn;
    if (!end) {
      undated.push(`${m.code} ${m.title}`);
      continue;
    }
    const own = input.workstreams
      .filter((w) => w.milestoneId === m.id && w.firstDay)
      .map((w) => w.firstDay!);
    const fromTasks = own.length ? own.reduce(min) : null;
    let start =
      (previousEnd ? addDays(previousEnd, 1) : null) ??
      fromTasks ??
      input.projectStart ??
      addDays(end, -14);
    if (fromTasks) start = min(start, fromTasks);
    if (start > end) start = end;
    msRange.set(m.id, { start, end });
    previousEnd = end;
  }

  const wsDates = new Map<
    string,
    { start: string; end: string; estimated: boolean }
  >();
  for (const w of input.workstreams) {
    const range = w.milestoneId ? msRange.get(w.milestoneId) : undefined;
    if (w.firstDay && w.lastDay) {
      wsDates.set(w.id, {
        start: min(w.firstDay, w.lastDay),
        end: max(w.firstDay, w.lastDay),
        estimated: false,
      });
    } else if (w.firstDay || w.lastDay) {
      const day = (w.firstDay ?? w.lastDay)!;
      wsDates.set(w.id, {
        start: range ? min(range.start, day) : day,
        end: range ? max(range.end, day) : day,
        estimated: !range,
      });
    } else if (range) {
      wsDates.set(w.id, { ...range, estimated: true });
    }
  }
  for (const w of input.workstreams) {
    const d = wsDates.get(w.id);
    if (d)
      wsEnd.set(w.id, {
        end: d.end,
        done: w.status === "done",
        title: w.title,
      });
  }

  const workstreamBar = (w: TimelineWorkstreamIn): TimelineBar | null => {
    const d = wsDates.get(w.id);
    if (!d) return null;
    const deps = w.dependsOn
      .map((id) => wsEnd.get(id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    return {
      kind: "workstream",
      id: w.id,
      label: w.title,
      code: null,
      start: d.start,
      end: d.end,
      estimated: d.estimated,
      status: w.status,
      progressPct: w.progressPct,
      dependsOn: deps.map((x) => x.title),
      conflict:
        w.status !== "done" && deps.some((x) => !x.done && x.end > d.start),
    };
  };

  for (const m of input.milestones) {
    const r = msRange.get(m.id);
    if (!r) continue;
    bars.push({
      kind: "milestone",
      id: m.id,
      label: m.title,
      code: m.code,
      start: r.start,
      end: r.end,
      estimated: false,
      status: m.status,
      progressPct: m.progressPct,
      dependsOn: [],
      conflict: false,
    });
    for (const w of input.workstreams.filter((x) => x.milestoneId === m.id)) {
      const bar = workstreamBar(w);
      if (bar) bars.push(bar);
    }
  }
  for (const w of input.workstreams.filter(
    (x) => !x.milestoneId || !msRange.has(x.milestoneId),
  )) {
    const bar = workstreamBar(w);
    if (bar) bars.push(bar);
  }

  const days = [
    input.today,
    ...(input.projectStart ? [input.projectStart] : []),
    ...(input.projectEnd ? [input.projectEnd] : []),
    ...bars.flatMap((b) => [b.start, b.end]),
  ];
  const start = addDays(days.reduce(min), -3);
  const end = addDays(days.reduce(max), 3);
  return { start, end, bars, undated };
}

/** Posição de um intervalo no gráfico, em porcentagem da largura. */
export function barPosition(
  range: { start: string; end: string },
  start: string,
  end: string,
): { left: number; width: number } {
  const total = toTime(range.end) - toTime(range.start) + DAY;
  const left = ((toTime(start) - toTime(range.start)) / total) * 100;
  const width = ((toTime(end) - toTime(start) + DAY) / total) * 100;
  return {
    left: Math.max(0, Math.min(100, left)),
    width: Math.max(0.8, Math.min(100 - Math.max(0, left), width)),
  };
}

/** Primeiro dia de cada mês dentro do intervalo, para a régua. */
export function monthTicks(range: { start: string; end: string }): string[] {
  const ticks: string[] = [];
  let day = `${range.start.slice(0, 7)}-01`;
  if (day < range.start) {
    const [y, m] = day.split("-").map(Number);
    day = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }
  while (day <= range.end) {
    ticks.push(day);
    const [y, m] = day.split("-").map(Number);
    day = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }
  return ticks;
}
