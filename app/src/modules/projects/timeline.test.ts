import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inTx } from "@/modules/context";
import { createTask } from "@/modules/tasks/service";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { projectTimeline } from "./timeline";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

beforeAll(async () => {
  h = await openTestHub();
  await h.raw.query(
    `update ${S}.milestones set due_date = '2026-10-31' where id = $1`,
    [h.vitMilestone],
  );
  const other = (
    await h.raw.query<{ id: string }>(
      `insert into ${S}.workstreams (workspace_id, project_id, milestone_id, title)
       values ($1, $2, $3, 'Telas') returning id`,
      [h.ws, h.vit, h.vitMilestone],
    )
  ).rows[0];
  // "Telas" depende do fluxo, que só termina no dia 20.
  await h.raw.query(
    `insert into ${S}.workstream_dependencies (workspace_id, workstream_id, depends_on_id)
     values ($1, $2, $3)`,
    [h.ws, other.id, h.vitWorkstream],
  );
  await inTx(asOwner(), async (t) => {
    await createTask(t, {
      project: "VIT",
      title: "Fluxo pronto",
      workstream_id: h.vitWorkstream,
      start_date: "2026-10-01",
      due_date: "2026-10-20",
    });
    await createTask(t, {
      project: "VIT",
      title: "Telas prontas",
      workstream_id: other.id,
      start_date: "2026-10-12",
      due_date: "2026-10-25",
    });
  });
});

afterAll(async () => {
  await h.db.close();
});

describe("linha do tempo do projeto", () => {
  it("datas das frentes pelas tarefas e o alerta de dependência", async () => {
    const { timeline } = await inTx(asOwner(), (t) =>
      projectTimeline(t, "VIT"),
    );
    expect(
      timeline.bars.map((b) => [b.kind, b.label, b.start, b.end, b.conflict]),
    ).toEqual([
      ["milestone", "Agente no WhatsApp", "2026-10-01", "2026-10-31", false],
      ["workstream", "Fluxo de atendimento", "2026-10-01", "2026-10-20", false],
      ["workstream", "Telas", "2026-10-12", "2026-10-25", true],
    ]);
    expect(timeline.bars[2].dependsOn).toEqual(["Fluxo de atendimento"]);
  });
});
