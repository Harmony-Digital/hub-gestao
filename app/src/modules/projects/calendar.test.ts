import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { createTask } from "@/modules/tasks/service";
import { ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { projectCalendar } from "./calendar";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

beforeAll(async () => {
  h = await openTestHub();
  await h.raw.query(
    `update ${S}.milestones set due_date = '2026-10-23' where id = $1`,
    [h.vitMilestone],
  );
  await h.raw.query(
    `insert into ${S}.milestones (workspace_id, project_id, code, title, visibility, due_date, sort_order)
     values ($1, $2, 'M2', 'Marco interno', 'internal', '2026-11-05', 2),
            ($1, $2, 'M3', 'Fora do mês', 'client', '2027-01-10', 3)`,
    [h.ws, h.vit],
  );
  await inTx(asOwner(), async (t) => {
    await createTask(t, {
      project: "VIT",
      title: "Revisar o fluxo",
      due_date: "2026-10-20",
      assignee: "me",
    });
    await createTask(t, { project: "VIT", title: "Sem prazo" });
  });
});

afterAll(async () => {
  await h.db.close();
});

describe("calendário do projeto", () => {
  it("entregas e prazos dentro da grade, com o que é interno marcado", async () => {
    const data = await inTx(asOwner(), (t) =>
      projectCalendar(t, "VIT", { from: "2026-09-28", to: "2026-11-08" }),
    );
    expect(data.entries.map((e) => [e.kind, e.date, e.title])).toEqual([
      ["milestone", "2026-10-23", "Agente no WhatsApp"],
      ["milestone", "2026-11-05", "Marco interno"],
      ["task", "2026-10-20", "Revisar o fluxo"],
    ]);
    expect(data.entries[1]).toMatchObject({ internal: true });
    expect(data.entries[2]).toMatchObject({
      category: "todo",
      assignee: "Fábio Almeida",
    });
  });

  it("quem não participa do projeto não vê", async () => {
    const profile = (
      await h.raw.query<{ id: string }>(
        `insert into ${S}.profiles (email, full_name) values ('lia@exemplo.com', 'Lia') returning id`,
      )
    ).rows[0];
    await h.raw.query(
      `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'member')`,
      [h.ws, profile.id],
    );
    const lia: UserActor = {
      type: "user",
      id: profile.id,
      scope: "internal",
      role: "member",
      workspaceId: h.ws,
      name: "Lia",
    };
    const err = await inTx(ctxFor(h, lia, "ui"), (t) =>
      projectCalendar(t, "VIT", { from: "2026-09-28", to: "2026-11-08" }),
    ).catch((e: unknown) => e);
    expect(err instanceof HubError ? err.status : err).toBe(403);
  });
});
