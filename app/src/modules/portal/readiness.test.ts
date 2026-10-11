import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import { inTx } from "@/modules/context";
import { ctxFor, openTestHub, TEST_PEPPER, type TestHub } from "@/test/hub";
import { createContact, issuePortalLink, portalClient } from "./access";
import { portalReadiness } from "./readiness";

const S = "proj_hub_gestao";
let h: TestHub;
let clientId: string;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

beforeAll(async () => {
  h = await openTestHub();
  clientId = (await inTx(asOwner(), (t) => portalClient(t, "clinica-exemplo")))
    .id;
  await h.raw.query(
    `insert into ${S}.projects (workspace_id, client_id, code, name, status)
     values ($1, $2, 'VIR', 'Projeto em revisão', 'in_review')`,
    [h.ws, clientId],
  );
  // Marcada para o cliente, mas sem o título para ele: não aparece no portal.
  await h.raw.query(
    `insert into ${S}.milestones (workspace_id, project_id, code, title, visibility, sort_order)
     values ($1, $2, 'M2', 'Sem texto para o cliente', 'client', 2)`,
    [h.ws, h.vit],
  );
});

afterAll(async () => {
  await h.db.close();
});

describe("preparação do portal (OB-13)", () => {
  it("conta o que o cliente vai ver e o que falta, sem o projeto em revisão", async () => {
    const before = await inTx(asOwner(), (t) => portalReadiness(t, clientId));
    expect(before).toEqual({
      contacts: 0,
      released: 0,
      consented: 0,
      projects: [
        {
          code: "VIT",
          name: "Atendimento com IA",
          hasClientObjective: false,
          clientMilestones: 1,
          milestonesWithoutText: 1,
          clientWorkstreams: 0,
        },
      ],
    });

    await h.raw.query(
      `update ${S}.projects set objective_client = 'Atender os pacientes no WhatsApp.' where id = $1`,
      [h.vit],
    );
    const contact = await inTx(asOwner(), (t) =>
      createContact(t, clientId, {
        name: "Ana Souza",
        email: "ana@clinica.com.br",
        role: "client_viewer",
      }),
    );
    const issued = await inTx(asOwner(), (t) =>
      issuePortalLink(t, contact.id, {
        pepper: TEST_PEPPER,
        appUrl: "https://hub.exemplo.com.br",
      }),
    );
    // O convite (OB-13) sai com quem recebe, de quem e os projetos que ele vai ver.
    expect(issued.invite).toEqual({
      contactName: "Ana Souza",
      orgName: "Harmony Digital",
      projects: ["Atendimento com IA"],
    });

    const after = await inTx(asOwner(), (t) => portalReadiness(t, clientId));
    expect(after).toMatchObject({
      contacts: 1,
      released: 1,
      consented: 0,
      projects: [{ code: "VIT", hasClientObjective: true }],
    });
  });

  it("só a administração lê", async () => {
    const member: UserActor = { ...h.owner_actor, role: "member" };
    const err = await inTx(ctxFor(h, member, "ui"), (t) =>
      portalReadiness(t, clientId),
    ).catch((e: unknown) => e);
    expect(err instanceof HubError ? err.status : err).toBe(403);
  });
});
