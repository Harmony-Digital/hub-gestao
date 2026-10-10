import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  confirmPortalReceipt,
  portalSessionFromToken,
  recordPortalConsent,
  redeemPortalLink,
  type PortalSession,
} from "@/lib/portal/session";
import { inTx, type Ctx } from "@/modules/context";
import { systemActor } from "@/modules/jobs/service";
import {
  createContact,
  issuePortalLink,
  portalClient,
} from "@/modules/portal/access";
import { portalProject } from "@/modules/portal/views";
import { ctxFor, openTestHub, TEST_PEPPER, type TestHub } from "@/test/hub";
import { noteReceiptConfirmed } from "./receipt";
import { getMilestone } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
let clientId: string;
let approver: PortalSession;
let viewer: PortalSession;

const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asClient = (s: PortalSession): Ctx => ({
  db: h.db,
  actor: s.actor,
  source: "ui",
  requestId: "teste-recebimento",
});

async function contactSession(
  name: string,
  email: string,
  role: "client_viewer" | "client_approver",
) {
  const contact = await inTx(asOwner(), (t) =>
    createContact(t, clientId, { name, email, role }),
  );
  const issued = await inTx(asOwner(), (t) =>
    issuePortalLink(t, contact.id, {
      pepper: TEST_PEPPER,
      appUrl: "https://hub.exemplo.com.br",
    }),
  );
  const redeemed = await redeemPortalLink(
    h.db,
    issued.url.split("/portal/entrar/")[1],
    TEST_PEPPER,
  );
  const s = (await portalSessionFromToken(
    h.db,
    redeemed!.sessionToken,
    TEST_PEPPER,
  ))!;
  await recordPortalConsent(h.db, s.sessionHash);
  return s;
}

/** Marco do VIT, gravado pelo dono (o aceite exige uma pessoa, migração 0006). */
async function milestone(
  code: string,
  extra: {
    status?: "planned" | "delivered" | "accepted";
    visibility?: "client" | "internal";
    titleClient?: string | null;
    archived?: boolean;
  } = {},
): Promise<string> {
  const status = extra.status ?? "delivered";
  return inTx(asOwner(), async (t) => {
    const r = await t.tx.query<{ id: string }>(
      `insert into ${S}.milestones
         (workspace_id, project_id, code, title, title_client, visibility, status,
          sort_order, delivered_at, accepted_at, accepted_by_profile_id, archived_at)
       values ($1, $2, $3, $4, $5, $6::${S}.visibility, $7::${S}.milestone_status, 9,
               case when $7 in ('delivered', 'accepted') then now() end,
               case when $7 = 'accepted' then now() end,
               case when $7 = 'accepted' then $8::uuid end,
               case when $9 then now() end)
       returning id`,
      [
        h.ws,
        h.vit,
        code,
        `Marco interno ${code}`,
        extra.titleClient === undefined ? `Entrega ${code}` : extra.titleClient,
        extra.visibility ?? "client",
        status,
        h.owner,
        extra.archived ?? false,
      ],
    );
    return r.rows[0].id;
  });
}

beforeAll(async () => {
  h = await openTestHub();
  clientId = (await inTx(asOwner(), (t) => portalClient(t, "clinica-exemplo")))
    .id;
  await h.raw.query(
    `insert into ${S}.webhooks (workspace_id, url, events, secret_ciphertext)
     values ($1, 'https://hermes.exemplo.com.br/hub', array['client.receipt_confirmed'], 'x')`,
    [h.ws],
  );
  approver = await contactSession(
    "Ana Souza",
    "ana@clinica.com.br",
    "client_approver",
  );
  viewer = await contactSession(
    "Bia Lima",
    "bia@clinica.com.br",
    "client_viewer",
  );
});

afterAll(async () => {
  await h.db.close();
});

const confirm = (s: PortalSession, code: string, id: string) =>
  confirmPortalReceipt(h.db, s.sessionHash, code, id).then((r) => r.status);

describe("confirmar recebimento (D9)", () => {
  it("só com a opção do projeto ligada e só o contato decisor", async () => {
    const m2 = await milestone("M2");
    expect(await confirm(approver, "VIT", m2)).toBe("not_allowed");
    await h.raw.query(
      `update ${S}.projects set client_can_confirm_receipt = true where id = $1`,
      [h.vit],
    );
    expect(await confirm(viewer, "VIT", m2)).toBe("not_allowed");
    expect(await confirm(approver, "VIT", m2)).toBe("ok");
    expect(await confirm(approver, "VIT", m2)).toBe("already");

    const row = await h.raw.query<{
      by: string;
      name: string;
      at: Date | null;
      status: string;
    }>(
      `select client_received_by_profile_id as by, client_received_by_name as name,
              client_received_at as at, status::text as status
         from ${S}.milestones where id = $1`,
      [m2],
    );
    expect(row.rows[0]).toMatchObject({
      by: approver.actor.id,
      name: "Ana Souza",
      status: "delivered",
    });
    expect(row.rows[0].at).not.toBeNull();
    const log = await h.raw.query<{ actor_id: string; action: string }>(
      `select actor_id, action from ${S}.activity_log
        where entity_id = $1 and action = 'milestone.receipt_confirmed'`,
      [m2],
    );
    expect(log.rows).toEqual([
      { actor_id: approver.actor.id, action: "milestone.receipt_confirmed" },
    ]);

    // A equipe vê pela API (e pela Visão geral); o cliente, no portal.
    const dto = await inTx(asOwner(), (t) => getMilestone(t, m2));
    expect(dto).toMatchObject({ client_received_by: "Ana Souza" });
    expect(dto.client_received_at).not.toBeNull();
    const portal = await inTx(asClient(approver), (t) =>
      portalProject(t, "VIT"),
    );
    expect(portal.clientCanConfirm).toBe(true);
    expect(portal.milestones.find((m) => m.id === m2)).toMatchObject({
      receivedBy: "Ana Souza",
    });
  });

  it("vale para entrega aceita, sem mexer no aceite", async () => {
    const m3 = await milestone("M3", { status: "accepted" });
    expect(await confirm(approver, "VIT", m3)).toBe("ok");
    const row = await h.raw.query<{ status: string; by: string }>(
      `select status::text as status, accepted_by_profile_id as by
         from ${S}.milestones where id = $1`,
      [m3],
    );
    expect(row.rows[0]).toEqual({ status: "accepted", by: h.owner });
  });

  it("entrega não entregue, interna, arquivada, sem texto ou de outro projeto: não", async () => {
    const planned = await milestone("M4", { status: "planned" });
    const internal = await milestone("M5", { visibility: "internal" });
    const archived = await milestone("M6", { archived: true });
    const noText = await milestone("M7", { titleClient: null });
    for (const id of [planned, internal, archived, noText]) {
      expect(await confirm(approver, "VIT", id)).toBe("not_found");
    }
    const m8 = await milestone("M8");
    expect(await confirm(approver, "HUB", m8)).toBe("not_found");
    expect(await confirm(approver, "VIT", "nao-e-um-id")).toBe("not_found");
    expect(
      await confirmPortalReceipt(h.db, "x".repeat(64), "VIT", m8).then(
        (r) => r.status,
      ),
    ).toBe("no_session");
  });

  it("avisa os donos e os webhooks", async () => {
    const m9 = await milestone("M9");
    const result = await confirmPortalReceipt(
      h.db,
      approver.sessionHash,
      "VIT",
      m9,
    );
    expect(result.status).toBe("ok");
    await inTx(
      { db: h.db, actor: systemActor(h.ws), source: "ui", requestId: "aviso" },
      (t) => noteReceiptConfirmed(t, m9),
    );
    const notes = await h.raw.query<{ payload: Record<string, string> }>(
      `select payload from ${S}.notifications
        where type = 'client.receipt' and entity_id = $1`,
      [m9],
    );
    expect(notes.rows).toEqual([
      {
        payload: {
          project_code: "VIT",
          milestone: "M9",
          title: "Entrega M9",
          author: "Ana Souza",
        },
      },
    ]);
    const deliveries = await h.raw.query(
      `select 1 from ${S}.webhook_deliveries where event = 'client.receipt_confirmed'`,
    );
    expect(deliveries.rows).toHaveLength(1);
  });
});
