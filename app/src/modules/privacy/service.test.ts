import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import {
  portalSessionFromToken,
  postPortalComment,
  recordPortalConsent,
  redeemPortalLink,
} from "@/lib/portal/session";
import { noteClientMessage } from "@/modules/comments/client-channel";
import { inTx } from "@/modules/context";
import { systemActor } from "@/modules/jobs/service";
import {
  createContact,
  issuePortalLink,
  portalClient,
} from "@/modules/portal/access";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  TEST_PEPPER,
  type TestHub,
} from "@/test/hub";
import {
  anonymizeClientContacts,
  anonymizeContact,
  applyRetention,
  exportClientData,
  REMOVED_MESSAGE,
  REMOVED_NAME,
} from "./service";

const S = "proj_hub_gestao";
const EMAIL = "bia@clinica.com.br";
const NAME = "Beatriz Exemplo";
let h: TestHub;
let clientId: string;
let contactId: string;
let sessionToken: string;

const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asHub = () => ctxFor(h, systemActor(h.ws), "cron");

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

beforeAll(async () => {
  h = await openTestHub();
  clientId = (await inTx(asOwner(), (t) => portalClient(t, "clinica-exemplo")))
    .id;
  await h.raw.query(
    `insert into ${S}.webhooks (workspace_id, url, events, secret_ciphertext)
     values ($1, 'https://hermes.exemplo.com.br/hub', array['client.commented'], 'x')`,
    [h.ws],
  );
  // Conversa interna do projeto: nunca sai na exportação.
  await h.raw.query(
    `insert into ${S}.comments
       (workspace_id, project_id, entity_type, entity_id, body_md, author_type, author_id, author_name)
     values ($1, $2, 'project', $2, 'Conversa interna da equipe', 'user', $3, 'Fábio')`,
    [h.ws, h.vit, h.owner],
  );
  const contact = await inTx(asOwner(), (t) =>
    createContact(t, clientId, {
      name: NAME,
      email: EMAIL,
      role: "client_approver",
    }),
  );
  contactId = contact.id;
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
  sessionToken = redeemed!.sessionToken;
  const session = (await portalSessionFromToken(
    h.db,
    sessionToken,
    TEST_PEPPER,
  ))!;
  await recordPortalConsent(h.db, session.sessionHash);
  const sent = await postPortalComment(
    h.db,
    session.sessionHash,
    "VIT",
    "Meu telefone é 61 99999-0000, pode ligar.",
  );
  if (sent.status !== "ok") throw new Error("mensagem não foi");
  await inTx(asHub(), (t) => noteClientMessage(t, sent.commentId));
});

afterAll(async () => {
  await h.db.close();
});

describe("privacidade (LGPD)", () => {
  it("exporta os dados do cliente e dos contatos, sem segredo nem texto interno", async () => {
    const data = await inTx(asOwner(), (t) =>
      exportClientData(t, "clinica-exemplo"),
    );
    const bia = data.contatos.find((c) => c.email === EMAIL);
    expect(bia).toMatchObject({
      nome: NAME,
      papel: "decisor",
      acesso: "active",
      dados_excluidos_em: null,
    });
    expect(bia!.aceite_lgpd_em).not.toBeNull();
    expect(bia!.sessoes).toHaveLength(1);
    expect(bia!.links_de_acesso).toEqual([
      expect.objectContaining({ finalidade: "convite" }),
    ]);
    expect(bia!.mensagens).toEqual([
      expect.objectContaining({
        projeto: "VIT",
        texto: "Meu telefone é 61 99999-0000, pode ligar.",
      }),
    ]);
    expect(bia!.acoes_no_portal.map((a) => a.acao)).toContain(
      "comment.client_posted",
    );
    expect(data.projetos.map((p) => p.codigo)).toContain("VIT");
    const text = JSON.stringify(data);
    expect(text).not.toContain("Conversa interna");
    expect(text).not.toMatch(/token_hash|notes_internal|hub_ak_/);

    // Só o dono: agente não exporta.
    const agent = await agentActor(h, h.keys.todos);
    expect(
      await status(
        inTx(ctxFor(h, agent), (t) => exportClientData(t, "clinica-exemplo")),
      ),
    ).toBe(403);
  });

  it("exclui os dados pessoais do contato: o nome, o e-mail e as mensagens saem", async () => {
    // Antes: o nome está no aviso da equipe e na entrega de webhook da mensagem.
    for (const table of ["notifications", "webhook_deliveries"]) {
      expect(
        await count(
          h,
          `select count(*)::int as n from ${S}.${table} where payload::text like '%Beatriz%'`,
        ),
        table,
      ).toBeGreaterThan(0);
    }
    const result = await inTx(asOwner(), (t) => anonymizeContact(t, contactId));
    expect(result).toEqual({
      already: false,
      messages: 1,
      sessions: 1,
      links: 1,
    });

    const contact = await h.raw.query<{
      name: string;
      email: string;
      access_status: string;
      consent_at: unknown;
      anonymized_at: unknown;
    }>(
      `select name, email, access_status::text as access_status, consent_at, anonymized_at
         from ${S}.client_contacts where id = $1`,
      [contactId],
    );
    expect(contact.rows[0]).toMatchObject({
      name: REMOVED_NAME,
      email: `removido-${contactId.slice(0, 8)}@removido.invalid`,
      access_status: "revoked",
      consent_at: null,
    });
    expect(contact.rows[0].anonymized_at).not.toBeNull();
    const comment = await h.raw.query<{ body_md: string; author_name: string }>(
      `select body_md, author_name from ${S}.comments where acting_role = 'client_contact'`,
    );
    expect(comment.rows).toEqual([
      { body_md: REMOVED_MESSAGE, author_name: REMOVED_NAME },
    ]);

    // Nenhum lugar fora do histórico (só de inserção) guarda o nome, o e-mail ou a mensagem.
    for (const [table, column] of [
      ["client_contacts", "name || email"],
      ["profiles", "full_name || email"],
      ["comments", "body_md || author_name"],
      ["notifications", "payload::text"],
      ["webhook_deliveries", "payload::text"],
      ["milestones", "coalesce(client_received_by_name, '')"],
    ] as const) {
      expect(
        await count(
          h,
          `select count(*)::int as n from ${S}.${table}
            where ${column} ilike any (array['%Beatriz%', '%bia@clinica%', '%99999-0000%'])`,
        ),
        table,
      ).toBe(0);
    }
    // A sessão aberta deixou de valer, e o acesso não volta.
    expect(
      await portalSessionFromToken(h.db, sessionToken, TEST_PEPPER),
    ).toBeNull();
    expect(
      await status(
        inTx(asOwner(), (t) =>
          issuePortalLink(t, contactId, {
            pepper: TEST_PEPPER,
            appUrl: "https://hub.exemplo.com.br",
          }),
        ),
      ),
    ).toBe(422);

    // O histórico registra a exclusão sem o nome; repetir não faz nada.
    const log = await h.raw.query<{ after: Record<string, unknown> }>(
      `select after from ${S}.activity_log
        where action = 'client_contact.anonymized' and entity_id = $1`,
      [contactId],
    );
    expect(log.rows).toHaveLength(1);
    expect(JSON.stringify(log.rows[0].after)).not.toContain("Beatriz");
    expect(
      (await inTx(asOwner(), (t) => anonymizeContact(t, contactId))).already,
    ).toBe(true);
  });

  it("fim do contrato: exclui os dados de todos os contatos do cliente", async () => {
    for (const email of ["um@clinica.com.br", "dois@clinica.com.br"]) {
      await inTx(asOwner(), (t) =>
        createContact(t, clientId, {
          name: `Pessoa ${email}`,
          email,
          role: "client_viewer",
        }),
      );
    }
    const result = await inTx(asOwner(), (t) =>
      anonymizeClientContacts(t, clientId),
    );
    expect(result.contacts).toBeGreaterThanOrEqual(2);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.client_contacts
          where client_id = $1 and anonymized_at is null`,
        [clientId],
      ),
    ).toBe(0);
    // De novo: nada a fazer.
    expect(
      (await inTx(asOwner(), (t) => anonymizeClientContacts(t, clientId)))
        .contacts,
    ).toBe(0);
  });

  it("a limpeza diária apaga só o que passou do prazo", async () => {
    const old = (days: number) => `now() - interval '${days} days'`;
    await h.raw.query(
      `insert into ${S}.agent_denials (workspace_id, agent_id, source, status, action, reason, created_at)
       values ($1, $2, 'api', 403, 'velha', 'x', ${old(100)}),
              ($1, $2, 'api', 403, 'recente', 'x', ${old(10)})`,
      [h.ws, h.agents.kratos],
    );
    await h.raw.query(
      `insert into ${S}.jobs (workspace_id, type, status, run_at, updated_at)
       values ($1, 'teste-retencao', 'done', ${old(40)}, ${old(40)}),
              ($1, 'teste-retencao', 'done', ${old(5)}, ${old(5)}),
              ($1, 'teste-retencao', 'failed', ${old(100)}, ${old(100)}),
              ($1, 'teste-retencao', 'failed', ${old(50)}, ${old(50)})`,
      [h.ws],
    );
    await h.raw.query(
      `insert into ${S}.notifications (workspace_id, profile_id, type, payload, read_at, created_at)
       values ($1, $2, 'teste-retencao', '{}', ${old(200)}, ${old(200)}),
              ($1, $2, 'teste-retencao', '{}', null, ${old(200)}),
              ($1, $2, 'teste-retencao', '{}', ${old(10)}, ${old(10)})`,
      [h.ws, h.owner],
    );
    const before = async (sql: string) =>
      count(h, `select count(*)::int as n from ${S}.${sql}`);
    const removed = await inTx(asHub(), (t) => applyRetention(t));
    expect(removed).toMatchObject({
      agent_denials: 1,
      jobs: 2,
      notifications: 1,
    });
    expect(
      await before(`agent_denials where action in ('velha', 'recente')`),
    ).toBe(1);
    expect(await before(`jobs where type = 'teste-retencao'`)).toBe(2);
    expect(await before(`notifications where type = 'teste-retencao'`)).toBe(2);
  });
});
