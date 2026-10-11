import { describe, expect, it } from "vitest";
import {
  barPosition,
  buildTimeline,
  monthTicks,
  type TimelineMilestoneIn,
  type TimelineWorkstreamIn,
} from "./timeline-layout";

const milestone = (
  over: Partial<TimelineMilestoneIn> & { id: string; code: string },
): TimelineMilestoneIn => ({
  title: `Marco ${over.code}`,
  status: "planned",
  dueDate: null,
  deliveredOn: null,
  progressPct: 0,
  ...over,
});
const front = (
  over: Partial<TimelineWorkstreamIn> & { id: string },
): TimelineWorkstreamIn => ({
  milestoneId: null,
  title: `Frente ${over.id}`,
  status: "planned",
  progressPct: 0,
  firstDay: null,
  lastDay: null,
  dependsOn: [],
  ...over,
});

describe("linha do tempo", () => {
  it("marco começa depois do anterior; frente segue as tarefas ou o marco", () => {
    const t = buildTimeline({
      today: "2026-10-10",
      projectStart: "2026-09-01",
      projectEnd: "2026-12-15",
      milestones: [
        milestone({ id: "m1", code: "M1", dueDate: "2026-09-30" }),
        milestone({ id: "m2", code: "M2", dueDate: "2026-10-31" }),
        milestone({ id: "m3", code: "M3" }),
      ],
      workstreams: [
        front({
          id: "a",
          milestoneId: "m2",
          firstDay: "2026-10-05",
          lastDay: "2026-10-20",
        }),
        front({ id: "b", milestoneId: "m2" }),
      ],
    });
    expect(t.bars.map((b) => [b.id, b.start, b.end, b.estimated])).toEqual([
      ["m1", "2026-09-01", "2026-09-30", false],
      ["m2", "2026-10-01", "2026-10-31", false],
      ["a", "2026-10-05", "2026-10-20", false],
      ["b", "2026-10-01", "2026-10-31", true],
    ]);
    expect(t.undated).toEqual(["M3 Marco M3"]);
    // O intervalo cobre o projeto inteiro, com uma folga.
    expect(t.start).toBe("2026-08-29");
    expect(t.end).toBe("2026-12-18");
  });

  it("alerta quando a frente depende de outra que termina depois de ela começar", () => {
    const t = buildTimeline({
      today: "2026-10-10",
      projectStart: null,
      projectEnd: null,
      milestones: [milestone({ id: "m1", code: "M1", dueDate: "2026-10-31" })],
      workstreams: [
        front({
          id: "api",
          milestoneId: "m1",
          title: "Integração",
          firstDay: "2026-10-01",
          lastDay: "2026-10-20",
        }),
        front({
          id: "tela",
          milestoneId: "m1",
          title: "Telas",
          firstDay: "2026-10-12",
          lastDay: "2026-10-25",
          dependsOn: ["api"],
        }),
        front({
          id: "texto",
          milestoneId: "m1",
          title: "Textos",
          firstDay: "2026-10-21",
          lastDay: "2026-10-28",
          dependsOn: ["api"],
        }),
      ],
    });
    const tela = t.bars.find((b) => b.id === "tela")!;
    expect(tela).toMatchObject({ dependsOn: ["Integração"], conflict: true });
    expect(t.bars.find((b) => b.id === "texto")?.conflict).toBe(false);
  });

  it("posição em porcentagem e a régua dos meses", () => {
    const range = { start: "2026-10-01", end: "2026-10-31" };
    expect(barPosition(range, "2026-10-01", "2026-10-31")).toEqual({
      left: 0,
      width: 100,
    });
    const half = barPosition(range, "2026-10-16", "2026-10-31");
    expect(Math.round(half.left)).toBe(48);
    expect(monthTicks({ start: "2026-09-15", end: "2026-12-01" })).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
    ]);
  });
});
