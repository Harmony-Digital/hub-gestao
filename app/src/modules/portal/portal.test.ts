import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import {
  portalSessionFromToken,
  recordPortalConsent,
  redeemPortalLink,
  endPortalSession,
} from "@/lib/portal/session";
import { inTx } from "@/modules/context";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  TEST_PEPPER,
  type TestHub,
} from "@/test/hub";
import {
  createContact,
  issuePortalLink,
  listContacts,
  portalClient,
  revokePortalAccess,
} from "./access";
import { portalProjects } from "./views";

const S = "proj_hub_gestao";
const APP = "https://hub.exemplo.com.br";
let h: TestHub;
let clientId: string;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const tokenOf = (url: string) => url.split("/portal/entrar/")[1];

beforeAll(async () => {
  h = await openTestHub();
  clientId = (await inTx(asOwner(), (t) => portalClient(t, "clinica-exemplo")))
    .id;
  // O M1 do VIT marcado para o cliente; outro projeto do mesmo cliente, em revisão; e
  // um projeto de outro cliente: nenhum dos dois pode aparecer no portal.
  await h.raw.query(
    `update ${S}.milestones set visibility = 'client' where id = $1`,
    [h.vitMilestone],
  );
  await h.raw.query(
    `insert into ${S}.projects (workspace_id, client_id, code, name, status)
     values ($1, $2, 'VIR', 'Projeto em revisão', 'in_review')`,
    [h.ws, clientId],
  );
  await h.raw.query(
    `update ${S}.projects set objective_client = 'Atender os pacientes no WhatsApp.',
            objective_internal = 'Margem interna de 40%.' where id = $1`,
    [h.vit],
  );
});

afterAll(async () => {
  await h.db.close();
});

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

describe("acesso ao portal (D9)", () => {
  let contactId: string;
  let firstLink: string;
  let sessionToken: string;

  it("o contato nasce sem acesso; só o dono libera", async () => {
    contactId = (
      await inTx(asOwner(), (t) =>
        createContact(t, clientId, {
          name: "Ana Souza",
          email: "Ana@Clinica.com.br",
          role: "client_approver",
        }),
      )
    ).id;
    const [contact] = await inTx(asOwner(), (t) => listContacts(t, clientId));
    expect(contact).toMatchObject({
      name: "Ana Souza",
      email: "ana@clinica.com.br",
      accessStatus: "none",
      pendingLinkUntil: null,
    });
    const admin: UserActor = { ...h.owner_actor, role: "admin" };
    expect(
      await status(
        inTx(ctxFor(h, admin, "ui"), (t) =>
          issuePortalLink(t, contactId, { pepper: TEST_PEPPER, appUrl: APP }),
        ),
      ),
    ).toBe(403);
    const agent = await agentActor(h, h.keys.todos);
    expect(
      await status(
        inTx(ctxFor(h, agent, "mcp"), (t) =>
          issuePortalLink(t, contactId, { pepper: TEST_PEPPER, appUrl: APP }),
        ),
      ),
    ).toBe(403);
  });

  it("liberar gera o link de uso único, liga o portal e cria o perfil do contato", async () => {
    const issued = await inTx(asOwner(), (t) =>
      issuePortalLink(t, contactId, { pepper: TEST_PEPPER, appUrl: APP }),
    );
    expect(issued.released).toBe(true);
    expect(issued.url).toMatch(
      /^https:\/\/hub\.exemplo\.com\.br\/portal\/entrar\/[A-Za-z0-9_-]{43}$/,
    );
    firstLink = tokenOf(issued.url);
    const row = await h.raw.query<{
      access_status: string;
      profile_id: string | null;
      portal_enabled: boolean;
    }>(
      `select c.access_status::text as access_status, c.profile_id, cl.portal_enabled
         from ${S}.client_contacts c join ${S}.clients cl on cl.id = c.client_id
        where c.id = $1`,
      [contactId],
    );
    expect(row.rows[0]).toMatchObject({
      access_status: "invited",
      portal_enabled: true,
    });
    expect(row.rows[0].profile_id).not.toBeNull();
    // No banco e no histórico, só o hash: o link em claro não fica guardado.
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.client_access_links where token_hash = $1`,
        [firstLink],
      ),
    ).toBe(0);
    const log = await h.raw.query(
      `select after from ${S}.activity_log where entity_id = $1`,
      [contactId],
    );
    expect(JSON.stringify(log.rows)).not.toContain(firstLink);
  });

  it("o link vale uma vez e abre uma sessão de cliente; o consentimento fica registrado", async () => {
    const redeemed = await redeemPortalLink(h.db, firstLink, TEST_PEPPER);
    expect(redeemed?.clientSlug).toBe("clinica-exemplo");
    sessionToken = redeemed!.sessionToken;
    expect(await redeemPortalLink(h.db, firstLink, TEST_PEPPER)).toBeNull();
    expect(
      await redeemPortalLink(h.db, "x".repeat(43), TEST_PEPPER),
    ).toBeNull();

    const session = await portalSessionFromToken(
      h.db,
      sessionToken,
      TEST_PEPPER,
    );
    expect(session).toMatchObject({
      clientSlug: "clinica-exemplo",
      contactName: "Ana Souza",
      consentAt: null,
      actor: {
        type: "user",
        scope: "client",
        clientId,
        contactRole: "client_approver",
      },
    });
    expect(await recordPortalConsent(h.db, session!.sessionHash)).toBe(true);
    const again = await portalSessionFromToken(h.db, sessionToken, TEST_PEPPER);
    expect(again?.consentAt).not.toBeNull();
    const [contact] = await inTx(asOwner(), (t) => listContacts(t, clientId));
    expect(contact.accessStatus).toBe("active");
  });

  it("o cliente só enxerga os próprios projetos ativos, com o texto escrito para ele", async () => {
    const session = await portalSessionFromToken(
      h.db,
      sessionToken,
      TEST_PEPPER,
    );
    const projects = await inTx(
      { db: h.db, actor: session!.actor, source: "ui", requestId: "portal" },
      (t) => portalProjects(t),
    );
    expect(projects).toEqual([
      {
        code: "VIT",
        name: "Atendimento com IA",
        phase: "descobrir",
        objective: "Atender os pacientes no WhatsApp.",
        progressPct: 0,
        targetDate: null,
        nextMilestone: {
          title: "Atendente virtual no WhatsApp",
          dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        },
      },
    ]);
    expect(JSON.stringify(projects)).not.toContain("Margem interna");
    // A equipe não usa a leitura do portal.
    expect(await status(inTx(asOwner(), (t) => portalProjects(t)))).toBe(403);
  });

  it("gerar outro link anula o anterior; revogar encerra a sessão na hora", async () => {
    const second = await inTx(asOwner(), (t) =>
      issuePortalLink(t, contactId, { pepper: TEST_PEPPER, appUrl: APP }),
    );
    expect(second.released).toBe(false);
    const third = await inTx(asOwner(), (t) =>
      issuePortalLink(t, contactId, { pepper: TEST_PEPPER, appUrl: APP }),
    );
    expect(
      await redeemPortalLink(h.db, tokenOf(second.url), TEST_PEPPER),
    ).toBeNull();

    await inTx(asOwner(), (t) => revokePortalAccess(t, contactId));
    expect(
      await portalSessionFromToken(h.db, sessionToken, TEST_PEPPER),
    ).toBeNull();
    expect(
      await redeemPortalLink(h.db, tokenOf(third.url), TEST_PEPPER),
    ).toBeNull();
    const [contact] = await inTx(asOwner(), (t) => listContacts(t, clientId));
    expect(contact).toMatchObject({
      accessStatus: "revoked",
      pendingLinkUntil: null,
    });
  });

  it("e-mail de alguém da equipe nunca vira contato com acesso", async () => {
    const owner = await h.raw.query<{ email: string }>(
      `select email from ${S}.profiles where id = $1`,
      [h.owner],
    );
    expect(
      await status(
        inTx(asOwner(), (t) =>
          createContact(t, clientId, {
            name: "Alguém da equipe",
            email: owner.rows[0].email.toUpperCase(),
            role: "client_viewer",
          }),
        ),
      ),
    ).toBe(422);
    // A pessoa entra para a equipe depois de cadastrada como contato: liberar recusa.
    const late = (
      await inTx(asOwner(), (t) =>
        createContact(t, clientId, {
          name: "Bruno Lima",
          email: "bruno@clinica.com.br",
          role: "client_viewer",
        }),
      )
    ).id;
    await h.raw.query(
      `with p as (
         insert into ${S}.profiles (email, full_name) values ('bruno@clinica.com.br', 'Bruno Lima')
         returning id
       )
       insert into ${S}.memberships (workspace_id, profile_id, role) select $1, id, 'member' from p`,
      [h.ws],
    );
    expect(
      await status(
        inTx(asOwner(), (t) =>
          issuePortalLink(t, late, { pepper: TEST_PEPPER, appUrl: APP }),
        ),
      ),
    ).toBe(422);
    const [bruno] = (
      await inTx(asOwner(), (t) => listContacts(t, clientId))
    ).filter((c) => c.id === late);
    expect(bruno).toMatchObject({
      accessStatus: "none",
      pendingLinkUntil: null,
    });
  });

  it("liberar de novo, entrar e sair: a sessão encerrada não vale mais", async () => {
    const issued = await inTx(asOwner(), (t) =>
      issuePortalLink(t, contactId, { pepper: TEST_PEPPER, appUrl: APP }),
    );
    expect(issued.released).toBe(true);
    const redeemed = await redeemPortalLink(
      h.db,
      tokenOf(issued.url),
      TEST_PEPPER,
    );
    const session = await portalSessionFromToken(
      h.db,
      redeemed!.sessionToken,
      TEST_PEPPER,
    );
    expect(session).not.toBeNull();
    await endPortalSession(h.db, session!.sessionHash);
    expect(
      await portalSessionFromToken(h.db, redeemed!.sessionToken, TEST_PEPPER),
    ).toBeNull();
  });
});
