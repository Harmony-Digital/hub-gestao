import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import {
  endPortalSession,
  portalSessionFromToken,
  postPortalComment,
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
import { portalChannel } from "@/modules/portal/views";
import {
  agentActor,
  ctxFor,
  openTestHub,
  TEST_PEPPER,
  type TestHub,
} from "@/test/hub";
import {
  clientChannel,
  noteClientMessage,
  postToClientChannel,
} from "./client-channel";

const S = "proj_hub_gestao";
let h: TestHub;
let clientId: string;
let session: PortalSession;

const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asClient = (): Ctx => ({
  db: h.db,
  actor: session.actor,
  source: "ui",
  requestId: "teste-canal",
});

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

/** Contato com acesso liberado e uma sessão aberta (com ou sem o aceite). */
async function contactSession(email: string, consent = true) {
  const contact = await inTx(asOwner(), (t) =>
    createContact(t, clientId, {
      name: `Contato ${email.split("@")[0]}`,
      email,
      role: "client_viewer",
    }),
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
  if (consent) await recordPortalConsent(h.db, s.sessionHash);
  return s;
}

beforeAll(async () => {
  h = await openTestHub();
  clientId = (await inTx(asOwner(), (t) => portalClient(t, "clinica-exemplo")))
    .id;
  await h.raw.query(
    `insert into ${S}.projects (workspace_id, client_id, code, name, status)
     values ($1, $2, 'VIR', 'Projeto em revisão', 'in_review')`,
    [h.ws, clientId],
  );
  // Conversa interna do projeto: nunca no canal.
  await h.raw.query(
    `insert into ${S}.comments
       (workspace_id, project_id, entity_type, entity_id, body_md, author_type, author_id, author_name)
     values ($1, $2, 'project', $2, 'Conversa interna', 'user', $3, 'Fábio')`,
    [h.ws, h.vit, h.owner],
  );
  // Webhook que assina as mensagens de cliente (o do Telegram, pelo Hermes).
  await h.raw.query(
    `insert into ${S}.webhooks (workspace_id, url, events, secret_ciphertext)
     values ($1, 'https://hermes.exemplo.com.br/hub', array['client.commented'], 'x')`,
    [h.ws],
  );
  session = await contactSession("ana@clinica.com.br");
});

afterAll(async () => {
  await h.db.close();
});

describe("canal do cliente", () => {
  it("o cliente escreve pelo portal, em nome dele, e a equipe recebe o aviso", async () => {
    const sent = await postPortalComment(
      h.db,
      session.sessionHash,
      "VIT",
      "  Podemos testar na quinta?  ",
    );
    expect(sent.status).toBe("ok");
    if (sent.status !== "ok") return;

    const row = await h.raw.query<{
      body_md: string;
      visibility: string;
      author_id: string;
      author_name: string;
      acting_role: string;
    }>(
      `select body_md, visibility::text as visibility, author_id, author_name, acting_role
         from ${S}.comments where id = $1`,
      [sent.commentId],
    );
    expect(row.rows[0]).toEqual({
      body_md: "Podemos testar na quinta?",
      visibility: "client",
      author_id: session.actor.id,
      author_name: "Contato ana",
      acting_role: "client_contact",
    });
    const log = await h.raw.query<{ actor_id: string; action: string }>(
      `select actor_id, action from ${S}.activity_log where entity_id = $1`,
      [sent.commentId],
    );
    expect(log.rows).toEqual([
      { actor_id: session.actor.id, action: "comment.client_posted" },
    ]);

    await inTx(
      {
        db: h.db,
        actor: systemActor(h.ws),
        source: "ui",
        requestId: "aviso",
      },
      (t) => noteClientMessage(t, sent.commentId),
    );
    const notes = await h.raw.query<{
      profile_id: string;
      payload: Record<string, string>;
    }>(
      `select profile_id, payload from ${S}.notifications where type = 'client.comment'`,
    );
    expect(notes.rows).toEqual([
      {
        profile_id: h.owner,
        payload: {
          project_code: "VIT",
          author: "Contato ana",
          excerpt: "Podemos testar na quinta?",
        },
      },
    ]);
    const deliveries = await h.raw.query<{ event: string }>(
      `select event from ${S}.webhook_deliveries where event = 'client.commented'`,
    );
    expect(deliveries.rows).toHaveLength(1);
  });

  it("o banco recusa texto inválido, projeto que não é dele, sessão encerrada e sem aceite", async () => {
    const post = (hash: string, code: string, body: string) =>
      postPortalComment(h.db, hash, code, body).then((r) => r.status);
    expect(await post(session.sessionHash, "VIT", "   ")).toBe("invalid");
    expect(await post(session.sessionHash, "VIT", "x".repeat(4001))).toBe(
      "invalid",
    );
    expect(await post(session.sessionHash, "HUB", "Oi")).toBe("not_found");
    expect(await post(session.sessionHash, "VIR", "Oi")).toBe("not_found");
    expect(await post("x".repeat(64), "VIT", "Oi")).toBe("no_session");

    const noConsent = await contactSession("bia@clinica.com.br", false);
    expect(await post(noConsent.sessionHash, "VIT", "Oi")).toBe("no_session");
    const ended = await contactSession("caio@clinica.com.br");
    await endPortalSession(h.db, ended.sessionHash);
    expect(await post(ended.sessionHash, "VIT", "Oi")).toBe("no_session");
  });

  it("no máximo 20 mensagens por hora por contato", async () => {
    const busy = await contactSession("duda@clinica.com.br");
    for (let i = 1; i <= 20; i += 1) {
      const r = await postPortalComment(
        h.db,
        busy.sessionHash,
        "VIT",
        `Mensagem ${i}`,
      );
      expect(r.status).toBe("ok");
    }
    const over = await postPortalComment(
      h.db,
      busy.sessionHash,
      "VIT",
      "Mais uma",
    );
    expect(over.status).toBe("too_many");
  });

  it("a equipe responde (dono e administração); o cliente vê a conversa, nunca o interno", async () => {
    await inTx(asOwner(), (t) =>
      postToClientChannel(t, "VIT", "Pode sim, às 10h."),
    );
    const admin: UserActor = { ...h.owner_actor, role: "admin" };
    await inTx(ctxFor(h, admin, "ui"), (t) =>
      postToClientChannel(t, "VIT", "Confirmado na agenda."),
    );
    const member: UserActor = { ...h.owner_actor, role: "member" };
    expect(
      await status(
        inTx(ctxFor(h, member, "ui"), (t) =>
          postToClientChannel(t, "VIT", "Oi"),
        ),
      ),
    ).toBe(403);
    const agent = await agentActor(h, h.keys.kratos);
    expect(
      await status(
        inTx(ctxFor(h, agent, "mcp"), (t) =>
          postToClientChannel(t, "VIT", "Oi"),
        ),
      ),
    ).toBe(403);
    expect(
      await status(inTx(asOwner(), (t) => postToClientChannel(t, "VIR", "Oi"))),
    ).toBe(422);

    const seen = await inTx(asClient(), (t) => portalChannel(t, "VIT"));
    const texts = seen.map((m) => m.bodyMd);
    expect(texts[0]).toBe("Podemos testar na quinta?");
    expect(texts.slice(-2)).toEqual([
      "Pode sim, às 10h.",
      "Confirmado na agenda.",
    ]);
    expect(texts).not.toContain("Conversa interna");
    expect(seen.at(-1)?.fromClient).toBe(false);
    expect(seen[0].fromClient).toBe(true);
    expect(await status(inTx(asClient(), (t) => portalChannel(t, "HUB")))).toBe(
      404,
    );

    const team = await inTx(asOwner(), (t) => clientChannel(t, "VIT"));
    expect(team.portalEnabled).toBe(true);
    expect(team.messages.map((m) => m.bodyMd)).toEqual(texts);
  });

  it("agente não escreve no canal do cliente nem direto no banco", async () => {
    const agent = await agentActor(h, h.keys.kratos);
    expect(
      await status(
        inTx(ctxFor(h, agent, "mcp"), (t) =>
          t.tx.query(
            `insert into ${S}.comments
               (workspace_id, project_id, entity_type, entity_id, body_md, visibility,
                author_type, author_id, author_name)
             values ($1, $2, 'project', $2, 'Oi', 'client', 'agent', $3, 'Kratos')`,
            [h.ws, h.vit, agent.id],
          ),
        ),
      ),
    ).not.toBe(200);
  });
});
