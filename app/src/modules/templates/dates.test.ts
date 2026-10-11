import { describe, expect, it } from "vitest";
import { spreadDueDates } from "./dates";

describe("datas dos marcos do modelo", () => {
  it("espalha por igual entre o início e a entrega, com o último na entrega", () => {
    expect(spreadDueDates("2026-10-12", "2026-12-18", 4)).toEqual([
      "2026-10-29",
      "2026-11-15",
      "2026-12-01",
      "2026-12-18",
    ]);
    expect(spreadDueDates("2026-10-12", "2026-10-13", 1)).toEqual([
      "2026-10-13",
    ]);
  });

  it("sem início, sem entrega ou com a entrega antes do início, não inventa data", () => {
    expect(spreadDueDates("", "2026-12-18", 3)).toEqual([]);
    expect(spreadDueDates("2026-12-18", "2026-10-12", 3)).toEqual([]);
    expect(spreadDueDates("2026-10-12", "2026-12-18", 0)).toEqual([]);
  });
});
