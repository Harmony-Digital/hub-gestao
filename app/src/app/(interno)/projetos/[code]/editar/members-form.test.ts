import { describe, expect, it } from "vitest";
import { parseMemberForm, parseMemberRemoveForm } from "./members-form";

const ID = "4dc6721e-2ac8-463d-84cb-3b25ab170bbd";
const fd = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};

describe("pessoas no projeto (RF-03)", () => {
  it("lê a pessoa e o papel; recusa papel e pessoa fora do formato", () => {
    expect(
      parseMemberForm(fd({ project: "VIT", profile_id: ID, role: "guest" })),
    ).toEqual({
      ok: true,
      value: { project: "VIT", profileId: ID, role: "guest" },
    });
    expect(
      parseMemberForm(fd({ project: "VIT", profile_id: ID, role: "owner" })).ok,
    ).toBe(false);
    expect(
      parseMemberForm(fd({ project: "VIT", profile_id: "", role: "member" })),
    ).toEqual({ ok: false, message: "Escolha a pessoa." });
    expect(
      parseMemberRemoveForm(fd({ project: "vit", profile_id: ID })).ok,
    ).toBe(false);
  });
});
