import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval } from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import { tick } from "@/modules/jobs/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";
import { REPORT_EMAIL_JOB, reportEmail } from "./email";
import { draftReport } from "./service";

const S = "proj_hub_gestao";
let h: TestHub;
const asOwner = () => ctxFor(h, h.owner_actor, "ui");
const CONFIG = { apiKey: "re_teste", from: "hub@exemplo.com", replyTo: null };

/** Envio simulado: guarda para quem foi e responde como o Resend. */
function fakeResend(to: string[]) {
  return (async (_url: string, init: { body: string }) => {
    to.push(...(JSON.parse(init.body) as { to: string[] }).to);
    return new Response(JSON.stringify({ id: `e-${to.length}` }), {
      status: 200,
    });
  }) as unknown as typeof fetch;
}

let period = 0;
async function approvedClientReport() {
  period += 1;
  const day = String(period).padStart(2, "0");
  const draft = await inTx(
    ctxFor(h, await agentActor(h, h.keys.kratos), "mcp"),
    (t) =>
      draftReport(t, {
        project: "VIT",
        period_start: `2026-10-${day}`,
        period_end: `2026-10-${day}`,
        audience: "client",
        body_md: "A agenda está ligada ao atendimento.",
      }),
  );
  await inTx(asOwner(), (t) =>
    decideApproval(t, draft.approval.id, { decision: "approved" }),
  );
  return draft;
}

const queued = async () =>
  (
    await h.raw.query(
      `select 1 from ${S}.jobs where type = $1 and status = 'queued'`,
      [REPORT_EMAIL_JOB],
    )
  ).rows.length;

beforeAll(async () => {
  h = await openTestHub();
  const client = (
    await h.raw.query<{ client_id: string }>(
      `select client_id from ${S}.projects where id = $1`,
      [h.vit],
    )
  ).rows[0].client_id;
  await h.raw.query(
    `update ${S}.clients set portal_enabled = true where id = $1`,
    [client],
  );
  await h.raw.query(
    `insert into ${S}.client_contacts (workspace_id, client_id, name, email, access_status, consent_at)
     values ($1, $2, 'Ana Souza', 'ana@clinica.exemplo', 'active', now()),
            ($1, $2, 'Bia Sem Aceite', 'bia@clinica.exemplo', 'active', null),
            ($1, $2, 'Caio Revogado', 'caio@clinica.exemplo', 'revoked', now())`,
    [h.ws, client],
  );
});

afterAll(async () => {
  await h.db.close();
});

describe("relatório aprovado por e-mail aos contatos (RF-34)", () => {
  it("o texto leva o relatório, o período e o link do portal", () => {
    const { subject, text } = reportEmail({
      contactName: "Ana Souza",
      orgName: "Harmony Digital",
      projectName: "Atendimento com IA",
      periodStart: "2026-10-05",
      periodEnd: "2026-10-09",
      body: "A agenda está ligada.",
      url: "https://hub.exemplo.com.br/portal/clinica/VIT",
    });
    expect(subject).toBe(
      "Relatório de Atendimento com IA: 05/10/2026 a 09/10/2026",
    );
    expect(text).toContain("Olá, Ana!");
    expect(text).toContain("A agenda está ligada.");
    expect(text).toContain("https://hub.exemplo.com.br/portal/clinica/VIT");
  });

  it("sem a opção do projeto, aprovar só publica", async () => {
    await approvedClientReport();
    expect(await queued()).toBe(0);
  });

  it("com a opção, aprovar põe o envio na fila, e o relógio manda só a quem tem acesso e aceite", async () => {
    await h.raw.query(
      `update ${S}.projects set email_client_reports = true where id = $1`,
      [h.vit],
    );
    const draft = await approvedClientReport();
    expect(await queued()).toBe(1);
    const decided = await h.raw.query<{ effect: Record<string, unknown> }>(
      `select effect from ${S}.approvals where id = $1`,
      [draft.approval.id],
    );
    expect(decided.rows[0].effect).toMatchObject({ report_email_queued: true });

    const to: string[] = [];
    const ran = await tick(h.db, h.ws, {
      email: { config: CONFIG, fetch: fakeResend(to) },
    });
    expect(ran.ran.find((j) => j.type === REPORT_EMAIL_JOB)?.result).toEqual({
      status: "sent",
      sent: 1,
      failed: 0,
    });
    expect(to).toEqual(["ana@clinica.exemplo"]);
    const logged = await h.raw.query<{ after: unknown }>(
      `select after from ${S}.activity_log where action = 'report.emailed'`,
    );
    expect(logged.rows).toEqual([{ after: { sent: 1, failed: 0 } }]);
    expect(JSON.stringify(logged.rows)).not.toContain("@");
  });

  it("sem o e-mail do Hub ligado, nada sai", async () => {
    await approvedClientReport();
    const ran = await tick(h.db, h.ws, { email: { config: null } });
    expect(ran.ran.find((j) => j.type === REPORT_EMAIL_JOB)?.result).toEqual({
      status: "skipped",
      reason: "e-mail do Hub desligado",
    });
  });

  it("agente não liga nem desliga a opção (trava do banco)", async () => {
    const err = await inTx(
      ctxFor(h, await agentActor(h, h.keys.kratos), "mcp"),
      (t) =>
        t.tx.query(
          `update ${S}.projects set email_client_reports = false where id = $1`,
          [h.vit],
        ),
    ).catch((e: unknown) => e);
    expect(String(err)).toMatch(/agentes não ligam o envio de relatório/);
  });
});
