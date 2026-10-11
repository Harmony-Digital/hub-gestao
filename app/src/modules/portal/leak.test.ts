import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubError } from "@/lib/errors";
import {
  portalSessionFromToken,
  redeemPortalLink,
  type PortalSession,
} from "@/lib/portal/session";
import { decideApproval } from "@/modules/approvals/service";
import { createComment } from "@/modules/comments/service";
import { inTx, type Ctx } from "@/modules/context";
import { draftReport } from "@/modules/reports/service";
import { createTask } from "@/modules/tasks/service";
import {
  agentActor,
  ctxFor,
  openTestHub,
  TEST_PEPPER,
  type TestHub,
} from "@/test/hub";
import { createContact, issuePortalLink, portalClient } from "./access";
import { portalAccent, portalProject, portalProjects } from "./views";

/**
 * Teste de vazamento do portal (PRD §5.2 e §9). O contato do cliente, com a sessão de
 * verdade, não enxerga nada além do que é do cliente e está marcado para ele: nem pela
 * RLS, tabela por tabela (inclusive as que ainda vão existir: tabela nova que o cliente
 * consiga ler reprova aqui até alguém decidir), nem pelas leituras do portal. Todo texto
 * interno do cenário leva a marca INTERNO; nenhuma resposta do portal pode trazê-la.
 */

const S = "proj_hub_gestao";
const MARK = "INTERNO";
let h: TestHub;
let session: PortalSession;
let clientId: string;

const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const asClient = (): Ctx => ({
  db: h.db,
  actor: session.actor,
  source: "ui",
  requestId: "teste-vazamento",
});

/** O que o cliente pode ler pela RLS (cada uma com a conferência das linhas abaixo). */
const CLIENT_READABLE = [
  "attachment_contents",
  "attachments",
  "client_contacts",
  "clients",
  "comments",
  "milestones",
  "profiles",
  "projects",
  "status_reports",
  "workspaces",
  "workstreams",
];

beforeAll(async () => {
  h = await openTestHub();
  clientId = (await inTx(asOwner(), (t) => portalClient(t, "clinica-exemplo")))
    .id;

  // Projeto do cliente (VIT): o texto interno leva a marca; o texto para o cliente, não.
  await h.raw.query(
    `update ${S}.projects
        set objective_internal = 'Objetivo ${MARK}',
            objective_client = 'Atender os pacientes no WhatsApp.'
      where id = $1`,
    [h.vit],
  );
  await h.raw.query(
    `update ${S}.milestones
        set title = 'Marco ${MARK}', visibility = 'client',
            description_client = 'Primeira versão no ar.'
      where id = $1`,
    [h.vitMilestone],
  );
  await h.raw.query(
    `update ${S}.workstreams
        set title = 'Frente ${MARK}', description_internal = 'Descrição ${MARK}'
      where id = $1`,
    [h.vitWorkstream],
  );
  await h.raw.query(
    `insert into ${S}.workstreams
       (workspace_id, project_id, milestone_id, title, title_client, description_internal,
        description_client, visibility)
     values ($1, $2, $3, 'Agenda ${MARK}', 'Integração com a agenda', 'Detalhe ${MARK}',
             'Consultas marcadas sem a recepção.', 'client')`,
    [h.ws, h.vit, h.vitMilestone],
  );
  // Marco interno (mesmo com texto para o cliente), marco arquivado e marco sem texto.
  await h.raw.query(
    `insert into ${S}.milestones
       (workspace_id, project_id, code, title, title_client, visibility, sort_order, archived_at)
     values ($1, $2, 'M2', 'Interno ${MARK}', 'Escondido ${MARK}', 'internal', 2, null),
            ($1, $2, 'M3', 'Arquivado ${MARK}', 'Arquivado ${MARK}', 'client', 3, now()),
            ($1, $2, 'M4', 'Sem texto ${MARK}', null, 'client', 4, null)`,
    [h.ws, h.vit],
  );
  // Datas do M1: a primeira não é revisão; as duas mudanças seguintes são.
  await h.raw.query(
    `insert into ${S}.milestone_date_history
       (workspace_id, milestone_id, old_due, new_due, reason_internal, changed_by_type, changed_by_id)
     values ($1, $2, null, current_date + 20, 'Motivo ${MARK}', 'user', $3),
            ($1, $2, current_date + 20, current_date + 25, 'Motivo ${MARK}', 'user', $3),
            ($1, $2, current_date + 25, current_date + 30, 'Motivo ${MARK}', 'user', $3)`,
    [h.ws, h.vitMilestone, h.owner],
  );
  // Camada operacional: tarefa com comentário.
  const task = await inTx(asOwner(), (t) =>
    createTask(t, {
      project: "VIT",
      title: `Tarefa ${MARK}`,
      workstream_id: h.vitWorkstream,
    }),
  );
  await inTx(asOwner(), (t) =>
    createComment(t, { task: task.code }, { body_md: `Comentário ${MARK}` }),
  );
  // Canal do projeto e arquivos: um interno e um para o cliente de cada.
  await h.raw.query(
    `insert into ${S}.comments
       (workspace_id, project_id, entity_type, entity_id, body_md, visibility,
        author_type, author_id, author_name)
     values ($1, $2, 'project', $2, 'Conversa ${MARK}', 'internal', 'user', $3, 'Fábio'),
            ($1, $2, 'project', $2, 'O atendimento entra no ar na sexta.', 'client', 'user', $3, 'Fábio')`,
    [h.ws, h.vit, h.owner],
  );
  const files = await h.raw.query<{ id: string }>(
    `insert into ${S}.attachments
       (workspace_id, project_id, entity_type, entity_id, storage_path, filename, visibility,
        uploaded_by_type, uploaded_by_id)
     values ($1, $2, 'project', $2, 'db', 'Planilha ${MARK}.pdf', 'internal', 'user', $3),
            ($1, $2, 'project', $2, 'db', 'Manual do atendimento.pdf', 'client', 'user', $3)
     returning id`,
    [h.ws, h.vit, h.owner],
  );
  for (const f of files.rows) {
    await h.raw.query(
      `insert into ${S}.attachment_contents (attachment_id, workspace_id, sha256, content)
       values ($1, $2, repeat('a', 64), '\\x25504446'::bytea)`,
      [f.id, h.ws],
    );
  }
  // Relatórios pelo caminho real: interno publicado, do cliente publicado e um rascunho.
  const kratos = ctxFor(h, await agentActor(h, h.keys.kratos), "mcp");
  const period = { period_start: "2026-10-05", period_end: "2026-10-09" };
  const internal = await inTx(kratos, (t) =>
    draftReport(t, {
      project: "VIT",
      ...period,
      audience: "internal",
      body_md: `Relatório ${MARK}`,
    }),
  );
  const forClient = await inTx(kratos, (t) =>
    draftReport(t, {
      project: "VIT",
      ...period,
      audience: "client",
      body_md:
        "Nesta semana, você ganhou o atendimento automático no WhatsApp.",
    }),
  );
  await inTx(kratos, (t) =>
    draftReport(t, {
      project: "VIT",
      period_start: "2026-10-12",
      period_end: "2026-10-16",
      audience: "client",
      body_md: `Rascunho ${MARK}`,
    }),
  );
  for (const id of [internal.approval.id, forClient.approval.id]) {
    await inTx(asOwner(), (t) =>
      decideApproval(t, id, { decision: "approved" }),
    );
  }
  // Projeto do mesmo cliente ainda em revisão: fora do portal.
  await h.raw.query(
    `insert into ${S}.projects (workspace_id, client_id, code, name, status)
     values ($1, $2, 'VIR', 'Revisão ${MARK}', 'in_review')`,
    [h.ws, clientId],
  );

  // O contato, com a sessão de verdade.
  const contact = await inTx(asOwner(), (t) =>
    createContact(t, clientId, {
      name: "Ana Souza",
      email: "ana@clinica.com.br",
      role: "client_approver",
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
});

afterAll(async () => {
  await h.db.close();
});

describe("vazamento no portal", () => {
  it("pela RLS, o cliente só lê as tabelas do portal, e nelas só o que é dele", async () => {
    const tables = (
      await h.raw.query<{ name: string }>(
        `select tablename as name from pg_tables where schemaname = $1 order by 1`,
        [S],
      )
    ).rows.map((r) => r.name);
    expect(tables.length).toBeGreaterThan(40);

    const seen = await inTx(asClient(), async (t) => {
      const counts: Record<string, number> = {};
      for (const name of tables) {
        counts[name] = (
          await t.tx.query<{ n: number }>(
            `select count(*)::int as n from ${S}.${name}`,
          )
        ).rows[0].n;
      }
      const col = async (sql: string) =>
        (await t.tx.query<{ v: string }>(sql)).rows.map((r) => r.v).sort();
      return {
        counts,
        projects: await col(`select code as v from ${S}.projects`),
        milestones: await col(`select code as v from ${S}.milestones`),
        workstreams: await col(
          `select coalesce(title_client, '-') as v from ${S}.workstreams`,
        ),
        comments: await col(`select visibility::text as v from ${S}.comments`),
        attachments: await col(
          `select visibility::text as v from ${S}.attachments`,
        ),
        contents: await col(
          `select a.filename as v from ${S}.attachment_contents c
             join ${S}.attachments a on a.id = c.attachment_id`,
        ),
        reports: await col(
          `select audience::text || ':' || (published_at is not null)::text as v
             from ${S}.status_reports`,
        ),
        clients: await col(`select id::text as v from ${S}.clients`),
        contacts: await col(`select email as v from ${S}.client_contacts`),
        profiles: await col(`select id::text as v from ${S}.profiles`),
      };
    });

    const readable = Object.entries(seen.counts)
      .filter(([, n]) => n > 0)
      .map(([name]) => name)
      .sort();
    expect(readable).toEqual(CLIENT_READABLE);
    expect(seen.projects).toEqual(["VIT"]);
    expect(seen.milestones).toEqual(["M1", "M4"]);
    expect(seen.workstreams).toEqual(["Integração com a agenda"]);
    expect(seen.comments).toEqual(["client"]);
    expect(seen.attachments).toEqual(["client"]);
    expect(seen.contents).toEqual(["Manual do atendimento.pdf"]);
    expect(seen.reports).toEqual(["client:true"]);
    expect(seen.clients).toEqual([clientId]);
    expect(seen.contacts).toEqual(["ana@clinica.com.br"]);
    expect(seen.profiles).toEqual([session.actor.id]);

    // O teste só vale se o lado interno existe de verdade.
    for (const name of [
      "tasks",
      "comments",
      "attachments",
      "attachment_contents",
      "status_reports",
      "milestone_date_history",
      "approvals",
      "notifications",
      "activity_log",
      "agents",
      "agent_api_keys",
      "memberships",
      "client_access_links",
      "client_sessions",
    ]) {
      const all = (
        await h.raw.query<{ n: number }>(
          `select count(*)::int as n from ${S}.${name}`,
        )
      ).rows[0].n;
      expect({ name, all: all > seen.counts[name] }).toEqual({
        name,
        all: true,
      });
    }
  });

  it("as leituras do portal não trazem texto interno, código de tarefa nem agente", async () => {
    const list = await inTx(asClient(), (t) => portalProjects(t));
    const project = await inTx(asClient(), (t) => portalProject(t, "VIT"));
    const all = JSON.stringify({ list, project });
    expect(all).not.toContain(MARK);
    expect(all).not.toMatch(/\bHUB-\d+\b/);
    expect(all).not.toContain("Kratos");

    expect(list.map((p) => p.code)).toEqual(["VIT"]);
    expect(project).toMatchObject({
      objective: "Atender os pacientes no WhatsApp.",
      otherWorkstreams: [],
      milestones: [
        {
          title: "Atendente virtual no WhatsApp",
          description: "Primeira versão no ar.",
          revisions: 2,
          status: "planned",
          workstreams: [
            {
              title: "Integração com a agenda",
              description: "Consultas marcadas sem a recepção.",
            },
          ],
        },
      ],
      reports: [
        {
          bodyMd:
            "Nesta semana, você ganhou o atendimento automático no WhatsApp.",
        },
      ],
    });
  });

  it("a cor de destaque do cliente é a única coisa do cadastro que o portal lê", async () => {
    await h.raw.query(
      `update ${S}.clients set accent_color = '#2E7D6B', notes_internal = 'Nota ${MARK}' where id = $1`,
      [clientId],
    );
    expect(await inTx(asClient(), (t) => portalAccent(t))).toBe("#2E7D6B");
    await expect(inTx(asOwner(), (t) => portalAccent(t))).rejects.toThrow(
      /portal do cliente/,
    );
  });

  it("projeto de outro cliente ou em revisão é 404; a contagem de revisões é só do cliente", async () => {
    for (const code of ["HUB", "VIR", "XYZ"]) {
      const err = await inTx(asClient(), (t) => portalProject(t, code)).catch(
        (e: unknown) => e,
      );
      expect(err instanceof HubError ? err.status : err).toBe(404);
    }
    const internalView = await inTx(asOwner(), (t) =>
      t.tx.query(`select * from ${S}.client_milestone_revisions($1)`, [h.vit]),
    );
    expect(internalView.rows).toEqual([]);
  });
});
