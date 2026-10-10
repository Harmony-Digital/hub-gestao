import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import {
  portalSessionFromToken,
  recordPortalConsent,
  redeemPortalLink,
  type PortalSession,
} from "@/lib/portal/session";
import { inTx, type Ctx } from "@/modules/context";
import {
  createContact,
  issuePortalLink,
  portalClient,
} from "@/modules/portal/access";
import { portalFiles, readPortalFile } from "@/modules/portal/views";
import { createTask } from "@/modules/tasks/service";
import {
  agentActor,
  ctxFor,
  openTestHub,
  TEST_PEPPER,
  type TestHub,
} from "@/test/hub";
import { addClientFile, clientFiles, removeClientFile } from "./client-files";
import { addAttachment, readAttachment } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
let session: PortalSession;

const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asClient = (): Ctx => ({
  db: h.db,
  actor: session.actor,
  source: "ui",
  requestId: "teste-arquivos",
});
const PDF = new TextEncoder().encode("%PDF-1.4\nEntrega do projeto\n");

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
  const clientId = (
    await inTx(asOwner(), (t) => portalClient(t, "clinica-exemplo"))
  ).id;
  await h.raw.query(
    `insert into ${S}.projects (workspace_id, client_id, code, name, status)
     values ($1, $2, 'VIR', 'Projeto em revisão', 'in_review')`,
    [h.ws, clientId],
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
  const redeemed = await redeemPortalLink(
    h.db,
    issued.url.split("/portal/entrar/")[1],
    TEST_PEPPER,
  );
  session = (await portalSessionFromToken(
    h.db,
    redeemed!.sessionToken,
    TEST_PEPPER,
  ))!;
  await recordPortalConsent(h.db, session.sessionHash);
});

afterAll(async () => {
  await h.db.close();
});

describe("arquivos entregues ao cliente", () => {
  let fileId: string;

  it("o dono entrega; o cliente vê e baixa pelo portal", async () => {
    const sent = await inTx(asOwner(), (t) =>
      addClientFile(t, "VIT", {
        name: "Manual do atendimento.pdf",
        bytes: PDF,
      }),
    );
    fileId = sent.id;
    const team = await inTx(asOwner(), (t) => clientFiles(t, "VIT"));
    expect(team).toMatchObject([
      {
        id: fileId,
        filename: "Manual do atendimento.pdf",
        mime: "application/pdf",
        sizeBytes: PDF.length,
        by: "Fábio Almeida",
      },
    ]);
    const seen = await inTx(asClient(), (t) => portalFiles(t, "VIT"));
    expect(seen.map((f) => f.filename)).toEqual(["Manual do atendimento.pdf"]);
    const file = await inTx(asClient(), (t) =>
      readPortalFile(t, "VIT", fileId),
    );
    expect(file.mime).toBe("application/pdf");
    expect(new Uint8Array(file.content)).toEqual(PDF);
    // A equipe abre pelo /anexos, como os anexos das tarefas.
    const forTeam = await inTx(asOwner(), (t) => readAttachment(t, fileId));
    expect(forTeam.filename).toBe("Manual do atendimento.pdf");
  });

  it("só dono e administração entregam; tipo, conteúdo e projeto em revisão são conferidos", async () => {
    const admin: UserActor = { ...h.owner_actor, role: "admin" };
    expect(
      await status(
        inTx(ctxFor(h, admin, "ui"), (t) =>
          addClientFile(t, "VIT", { name: "Proposta.pdf", bytes: PDF }),
        ),
      ),
    ).toBe(200);
    const member: UserActor = { ...h.owner_actor, role: "member" };
    expect(
      await status(
        inTx(ctxFor(h, member, "ui"), (t) =>
          addClientFile(t, "VIT", { name: "x.pdf", bytes: PDF }),
        ),
      ),
    ).toBe(403);
    const agent = await agentActor(h, h.keys.kratos);
    expect(
      await status(
        inTx(ctxFor(h, agent, "mcp"), (t) =>
          addClientFile(t, "VIT", { name: "x.pdf", bytes: PDF }),
        ),
      ),
    ).toBe(403);
    expect(
      await status(
        inTx(asOwner(), (t) =>
          addClientFile(t, "VIT", { name: "programa.exe", bytes: PDF }),
        ),
      ),
    ).toBe(422);
    expect(
      await status(
        inTx(asOwner(), (t) =>
          addClientFile(t, "VIT", {
            name: "falso.pdf",
            bytes: new TextEncoder().encode("não é pdf"),
          }),
        ),
      ),
    ).toBe(422);
    expect(
      await status(
        inTx(asOwner(), (t) =>
          addClientFile(t, "VIR", { name: "x.pdf", bytes: PDF }),
        ),
      ),
    ).toBe(422);
  });

  it("o cliente nunca baixa arquivo interno, de tarefa ou de outro cliente", async () => {
    const internal = await h.raw.query<{ id: string }>(
      `insert into ${S}.attachments
         (workspace_id, project_id, entity_type, entity_id, storage_path, filename, mime,
          size_bytes, visibility, uploaded_by_type, uploaded_by_id)
       values ($1, $2, 'project', $2, 'db', 'Planilha interna.pdf', 'application/pdf', 10,
               'internal', 'user', $3)
       returning id`,
      [h.ws, h.vit, h.owner],
    );
    await h.raw.query(
      `insert into ${S}.attachment_contents (attachment_id, workspace_id, sha256, content)
       values ($1, $2, repeat('a', 64), '\\x25504446'::bytea)`,
      [internal.rows[0].id, h.ws],
    );
    const task = await inTx(asOwner(), (t) =>
      createTask(t, { project: "VIT", title: "Tarefa com anexo" }),
    );
    const taskFile = await inTx(asOwner(), (t) =>
      addAttachment(t, task.code, { name: "rascunho.pdf", bytes: PDF }),
    );
    const otherClient = await inTx(asOwner(), (t) =>
      addClientFile(t, "HUB", { name: "Do Hub.pdf", bytes: PDF }),
    );

    const seen = await inTx(asClient(), (t) => portalFiles(t, "VIT"));
    const names = seen.map((f) => f.filename);
    expect(names).not.toContain("Planilha interna.pdf");
    expect(names).not.toContain("rascunho.pdf");
    for (const [code, id] of [
      ["VIT", internal.rows[0].id],
      ["VIT", taskFile.id],
      ["HUB", otherClient.id],
      ["VIT", otherClient.id],
      ["VIT", "nao-e-um-id"],
    ]) {
      expect(
        await status(inTx(asClient(), (t) => readPortalFile(t, code, id))),
      ).toBe(404);
    }
    expect(await inTx(asClient(), (t) => portalFiles(t, "HUB"))).toEqual([]);
  });

  it("tirar o arquivo tira do portal na hora, com registro no histórico", async () => {
    await inTx(asOwner(), (t) => removeClientFile(t, fileId));
    expect(
      await status(inTx(asClient(), (t) => readPortalFile(t, "VIT", fileId))),
    ).toBe(404);
    const log = await h.raw.query<{ action: string }>(
      `select action from ${S}.activity_log
        where action in ('attachment.client_added', 'attachment.client_removed')
        order by id`,
    );
    expect(log.rows.map((r) => r.action)).toEqual([
      "attachment.client_added",
      "attachment.client_added",
      "attachment.client_added",
      "attachment.client_removed",
    ]);
  });
});
