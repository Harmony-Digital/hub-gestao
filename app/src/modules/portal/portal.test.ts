import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import {
  portalSessionFromToken,
  recordPortalConsent,
  redeemPortalLink,
  endPortalSession,
  requestPortalLinks,
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
  inviteEmailTarget,
  issuePortalLink,
  listContacts,
  noteInviteEmailed,
  portalClient,
  revokePortalAccess,
} from "./access";
import { portalProject, portalProjects } from "./views";

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

  it("andamento: nunca abaixo da fatia de entregas, contando também os marcos internos", async () => {
    const session = await portalSessionFromToken(
      h.db,
      sessionToken,
      TEST_PEPPER,
    );
    const asClient = {
      db: h.db,
      actor: session!.actor,
      source: "ui" as const,
      requestId: "portal",
    };
    // Um marco interno a mais: a fatia conta todos, o cliente vê só o dele.
    await h.raw.query(
      `insert into ${S}.milestones (workspace_id, project_id, code, title, sort_order, visibility)
       select workspace_id, id, 'M90', 'Marco interno do teste', 90, 'internal'
         from ${S}.projects where id = $1`,
      [h.vit],
    );
    const visible = await h.raw.query<{ id: string }>(
      `select id from ${S}.milestones
        where project_id = $1 and visibility = 'client' and archived_at is null`,
      [h.vit],
    );
    const total = Number(
      (
        await h.raw.query<{ n: number }>(
          `select count(*)::int as n from ${S}.milestones
            where project_id = $1 and archived_at is null`,
          [h.vit],
        )
      ).rows[0].n,
    );
    await h.raw.query(
      `update ${S}.milestones set status = 'delivered', delivered_at = now() where id = $1`,
      [visible.rows[0].id],
    );
    try {
      const [project] = await inTx(asClient, (t) => portalProjects(t));
      expect(total).toBeGreaterThan(visible.rows.length);
      expect(project.progressPct).toBe(Math.round(100 / total));
      const detail = await inTx(asClient, (t) => portalProject(t, "VIT"));
      expect(detail.progressPct).toBe(Math.round(100 / total));
      expect(detail.deliveries).toEqual({
        done: 1,
        total: visible.rows.length,
      });
      expect(JSON.stringify(detail)).not.toContain("Marco interno do teste");
    } finally {
      await h.raw.query(
        `update ${S}.milestones set status = 'planned', delivered_at = null where id = $1`,
        [visible.rows[0].id],
      );
      await h.raw.query(
        `delete from ${S}.milestones where project_id = $1 and code = 'M90'`,
        [h.vit],
      );
    }
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

describe("convite do portal por e-mail (D9)", () => {
  it("só o dono, só com o acesso liberado; o histórico guarda o envio, nunca o link", async () => {
    const contactId = (
      await inTx(asOwner(), (t) =>
        createContact(t, clientId, {
          name: "Carla Convite",
          email: "carla.convite@clinica.com.br",
          role: "client_viewer",
        }),
      )
    ).id;
    // Antes de liberar, não há convite para mandar.
    expect(
      await status(inTx(asOwner(), (t) => inviteEmailTarget(t, contactId))),
    ).toBe(422);
    const issued = await inTx(asOwner(), (t) =>
      issuePortalLink(t, contactId, { pepper: TEST_PEPPER, appUrl: APP }),
    );
    expect(
      await inTx(asOwner(), (t) => inviteEmailTarget(t, contactId)),
    ).toMatchObject({
      email: "carla.convite@clinica.com.br",
      name: "Carla Convite",
    });
    const admin: UserActor = { ...h.owner_actor, role: "admin" };
    expect(
      await status(
        inTx(ctxFor(h, admin, "ui"), (t) => inviteEmailTarget(t, contactId)),
      ),
    ).toBe(403);
    await inTx(asOwner(), (t) => noteInviteEmailed(t, contactId, "email-123"));
    const log = await h.raw.query<{ after: unknown }>(
      `select after from ${S}.activity_log
        where action = 'portal.invite_emailed' and entity_id = $1`,
      [contactId],
    );
    expect(log.rows).toEqual([{ after: { email_id: "email-123" } }]);
    expect(JSON.stringify(log.rows)).not.toContain(tokenOf(issued.url));
    // Revogado, o convite não sai mais.
    await inTx(asOwner(), (t) => revokePortalAccess(t, contactId));
    expect(
      await status(inTx(asOwner(), (t) => inviteEmailTarget(t, contactId))),
    ).toBe(422);
  });
});

describe("link novo pedido pelo próprio contato (RF-05)", () => {
  const ask = (email: string) =>
    requestPortalLinks(h.db, email, { pepper: TEST_PEPPER, appUrl: APP });
  const newContact = (name: string, email: string, client = clientId) =>
    inTx(asOwner(), (t) =>
      createContact(t, client, { name, email, role: "client_viewer" }),
    ).then((c) => c.id);

  it("só quem o dono liberou recebe, com um link curto que vale uma vez", async () => {
    const contactId = await newContact(
      "Bruna Pedido",
      "bruna.pedido@clinica.com.br",
    );
    // Sem acesso liberado (D9), nada sai.
    expect(await ask("bruna.pedido@clinica.com.br")).toEqual([]);
    const invite = await inTx(asOwner(), (t) =>
      issuePortalLink(t, contactId, { pepper: TEST_PEPPER, appUrl: APP }),
    );

    // Maiúsculas e espaços não atrapalham; o link vem com o nome do cliente.
    const [link, ...rest] = await ask("  Bruna.Pedido@Clinica.com.br ");
    expect(rest).toEqual([]);
    expect(link).toMatchObject({
      email: "bruna.pedido@clinica.com.br",
      contactName: "Bruna Pedido",
      clientName: expect.any(String),
    });
    expect(link.url).toMatch(
      /^https:\/\/hub\.exemplo\.com\.br\/portal\/entrar\/[A-Za-z0-9_-]{43}$/,
    );
    // O convite que ainda não tinha sido usado deixa de valer (um link vivo por vez).
    expect(
      await redeemPortalLink(h.db, tokenOf(invite.url), TEST_PEPPER),
    ).toBeNull();
    const redeemed = await redeemPortalLink(
      h.db,
      tokenOf(link.url),
      TEST_PEPPER,
    );
    expect(redeemed?.clientSlug).toBe("clinica-exemplo");
    expect(
      await redeemPortalLink(h.db, tokenOf(link.url), TEST_PEPPER),
    ).toBeNull();

    // Vale por 30 minutos; o histórico registra o pedido, nunca o link.
    const row = await h.raw.query<{ minutes: number; purpose: string }>(
      `select round(extract(epoch from expires_at - created_at) / 60)::int as minutes, purpose
         from ${S}.client_access_links where contact_id = $1 and purpose = 'request'`,
      [contactId],
    );
    expect(row.rows).toEqual([{ minutes: 30, purpose: "request" }]);
    const logged = await h.raw.query<{ actor_type: string; after: unknown }>(
      `select actor_type::text as actor_type, after from ${S}.activity_log
        where entity_id = $1 and action = 'portal.link_requested'`,
      [contactId],
    );
    expect(logged.rows).toHaveLength(1);
    expect(logged.rows[0].actor_type).toBe("system");
    expect(JSON.stringify(logged.rows)).not.toContain(tokenOf(link.url));

    // Acesso revogado: nada sai.
    await inTx(asOwner(), (t) => revokePortalAccess(t, contactId));
    expect(await ask("bruna.pedido@clinica.com.br")).toEqual([]);
  });

  it("e-mail que não existe ou fora do formato não recebe nada", async () => {
    expect(await ask("ninguem@exemplo.com")).toEqual([]);
    expect(await ask("")).toEqual([]);
    expect(await ask("x".repeat(300))).toEqual([]);
  });

  it("no máximo 3 links pedidos por contato por hora", async () => {
    const contactId = await newContact(
      "Duda Limite",
      "duda.limite@clinica.com.br",
    );
    await inTx(asOwner(), (t) =>
      issuePortalLink(t, contactId, { pepper: TEST_PEPPER, appUrl: APP }),
    );
    for (let i = 0; i < 3; i++) {
      expect(await ask("duda.limite@clinica.com.br")).toHaveLength(1);
    }
    expect(await ask("duda.limite@clinica.com.br")).toEqual([]);
    // Só o último pedido vale.
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.client_access_links
          where contact_id = $1 and used_at is null and expires_at > now()`,
        [contactId],
      ),
    ).toBe(1);
  });

  it("a mesma pessoa contato de dois clientes recebe um link de cada", async () => {
    const other = (
      await h.raw.query<{ id: string }>(
        `insert into ${S}.clients (workspace_id, slug, name) values ($1, 'otica-pedido', 'Ótica Pedido') returning id`,
        [h.ws],
      )
    ).rows[0].id;
    const a = await newContact("Eva Duas", "eva.duas@exemplo.com");
    const b = await newContact("Eva Duas", "eva.duas@exemplo.com", other);
    for (const id of [a, b]) {
      await inTx(asOwner(), (t) =>
        issuePortalLink(t, id, { pepper: TEST_PEPPER, appUrl: APP }),
      );
    }
    const links = await ask("eva.duas@exemplo.com");
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => l.url)).size).toBe(2);
    const slugs = await Promise.all(
      links.map(
        async (l) =>
          (await redeemPortalLink(h.db, tokenOf(l.url), TEST_PEPPER))
            ?.clientSlug,
      ),
    );
    expect(slugs.sort()).toEqual(["clinica-exemplo", "otica-pedido"]);
  });
});
