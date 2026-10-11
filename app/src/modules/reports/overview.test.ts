import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { decideApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { reportsOverview, versionState } from "./overview";
import { draftReport } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asKratos = async () =>
  ctxFor(h, await agentActor(h, h.keys.kratos), "mcp");

beforeAll(async () => {
  h = await openTestHub();
});

afterAll(async () => {
  await h.db.close();
});

const draft = async (audience: "client" | "internal", body_md: string) =>
  inTx(await asKratos(), (t) =>
    draftReport(t, {
      project: "VIT",
      period_start: "2026-10-05",
      period_end: "2026-10-09",
      audience,
      body_md,
    }),
  );

describe("tela Relatórios", () => {
  it("situação de cada versão, pela publicação e pelo pedido", () => {
    const base = { id: "a", published_at: null, approval_id: "p" };
    expect(
      versionState({
        ...base,
        published_at: new Date(),
        approval_status: null,
        approval_entity: null,
      }),
    ).toBe("published");
    expect(
      versionState({
        ...base,
        approval_id: null,
        approval_status: null,
        approval_entity: null,
      }),
    ).toBe("draft");
    expect(
      versionState({
        ...base,
        approval_status: "pending",
        approval_entity: "a",
      }),
    ).toBe("pending");
    // O pedido passou para a versão do Redator do Cliente.
    expect(
      versionState({
        ...base,
        approval_status: "pending",
        approval_entity: "b",
      }),
    ).toBe("superseded");
    expect(
      versionState({
        ...base,
        approval_status: "cancelled",
        approval_entity: "a",
      }),
    ).toBe("superseded");
    expect(
      versionState({
        ...base,
        approval_status: "rejected",
        approval_entity: "a",
      }),
    ).toBe("rejected");
    expect(
      versionState({
        ...base,
        approval_status: "adjust_requested",
        approval_entity: "a",
      }),
    ).toBe("adjust");
  });

  it("agrupa as versões do mesmo relatório, da mais nova para a mais antiga", async () => {
    await draft("client", "Primeira versão para o cliente.");
    const v2 = await draft("client", "Segunda versão para o cliente.");
    const internal = await draft("internal", "Status interno.");
    await inTx(asOwner(), (t) =>
      decideApproval(t, v2.approval.id, { decision: "approved" }),
    );
    await inTx(asOwner(), (t) =>
      decideApproval(t, internal.approval.id, { decision: "rejected" }),
    );

    const groups = await inTx(asOwner(), (t) => reportsOverview(t));
    const client = groups.find((g) => g.audience === "client");
    expect(client?.versions.map((v) => [v.version, v.state, v.author])).toEqual(
      [
        [2, "published", "Kratos"],
        [1, "superseded", "Kratos"],
      ],
    );
    expect(
      groups.find((g) => g.audience === "internal")?.versions[0].state,
    ).toBe("rejected");
    const onlyClient = await inTx(asOwner(), (t) =>
      reportsOverview(t, { audience: "client" }),
    );
    expect(onlyClient.map((g) => g.audience)).toEqual(["client"]);
  });

  it("a equipe comum vê só os projetos de que participa", async () => {
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
    expect(await inTx(ctxFor(h, lia, "ui"), (t) => reportsOverview(t))).toEqual(
      [],
    );
    await h.raw.query(
      `insert into ${S}.project_members (workspace_id, project_id, profile_id, role)
       values ($1, $2, $3, 'member')`,
      [h.ws, h.vit, profile.id],
    );
    const seen = await inTx(ctxFor(h, lia, "ui"), (t) => reportsOverview(t));
    expect(seen.length).toBeGreaterThan(0);
  });
});
