import { audit } from "@/lib/audit";
import { appUrl } from "@/lib/auth/config";
import { emailConfig, sendEmail, type EmailConfig } from "@/lib/email";
import { formatDate } from "@/lib/format";
import { log } from "@/lib/log";
import {
  inTx,
  json,
  many,
  maybeOne,
  S,
  type Ctx,
  type TxCtx,
} from "@/modules/context";

/**
 * Relatório aprovado também por e-mail aos contatos (RF-34), quando o projeto liga a
 * opção (Editar projeto). A aprovação do dono publica o relatório no portal e põe este
 * envio na fila (job `report-email`): o texto aprovado vai, só em texto, a cada contato do
 * cliente com acesso ativo e com o aceite do uso dos dados, com o link do portal. Sem o
 * e-mail do Hub ligado, nada sai (falha fechada). O histórico guarda quantos foram, nunca
 * os endereços.
 */

export const REPORT_EMAIL_JOB = "report-email";

/** Na mesma transação da aprovação: só relatório para o cliente de projeto com a opção. */
export async function enqueueReportEmail(
  t: TxCtx,
  reportId: string,
): Promise<boolean> {
  const wanted = await maybeOne(
    t,
    `select 1 from ${S}.status_reports r
       join ${S}.projects p on p.id = r.project_id
      where r.id = $1 and r.audience = 'client' and p.email_client_reports`,
    [reportId],
  );
  if (!wanted) return false;
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.jobs (workspace_id, type, payload, run_at, dedupe_key)
     values ($1, $2, $3::jsonb, now(), $4)
     on conflict (workspace_id, dedupe_key)
       where dedupe_key is not null and status in ('queued', 'running')
     do nothing
     returning id`,
    [
      t.actor.workspaceId,
      REPORT_EMAIL_JOB,
      json({ report_id: reportId }),
      `${REPORT_EMAIL_JOB}:${reportId}`,
    ],
  );
  return row !== null;
}

/** O e-mail do relatório (puro): assunto e texto, com o link do portal quando houver. */
export function reportEmail(input: {
  contactName: string;
  orgName: string;
  projectName: string;
  periodStart: string;
  periodEnd: string;
  body: string;
  url: string | null;
}): { subject: string; text: string } {
  const first = input.contactName.trim().split(/\s+/)[0] || input.contactName;
  const period =
    input.periodStart === input.periodEnd
      ? formatDate(input.periodStart)
      : `${formatDate(input.periodStart)} a ${formatDate(input.periodEnd)}`;
  return {
    subject: `Relatório de ${input.projectName}: ${period}`,
    text: [
      `Olá, ${first}!`,
      "",
      `Segue o relatório de ${input.projectName}, de ${period}, preparado pela equipe da ${input.orgName}.`,
      "",
      input.body.trim(),
      "",
      input.url
        ? `Ele também está no portal, com o andamento do projeto: ${input.url}`
        : "Ele também está no portal do projeto.",
      "",
      "Qualquer dúvida, é só responder esta mensagem.",
    ].join("\n"),
  };
}

export type ReportEmailResult =
  | { status: "sent"; sent: number; failed: number }
  | { status: "skipped"; reason: string };

export async function sendReportEmails(
  ctx: Ctx,
  reportId: string,
  deps: { config?: EmailConfig | null; fetch?: typeof fetch } = {},
): Promise<ReportEmailResult> {
  const config = deps.config === undefined ? emailConfig() : deps.config;
  if (!config) return { status: "skipped", reason: "e-mail do Hub desligado" };
  const data = await inTx(ctx, async (t) => {
    const report = await maybeOne<{
      project_id: string;
      project_code: string;
      project_name: string;
      client_id: string;
      client_slug: string;
      body_md: string;
      period_start: string;
      period_end: string;
      org: string;
    }>(
      t,
      `select p.id as project_id, p.code as project_code, p.name as project_name,
              c.id as client_id, c.slug as client_slug, r.body_md,
              r.period_start::text as period_start, r.period_end::text as period_end,
              w.name as org
         from ${S}.status_reports r
         join ${S}.projects p on p.id = r.project_id
         join ${S}.clients c on c.id = p.client_id
         join ${S}.workspaces w on w.id = p.workspace_id
        where r.id = $1 and r.audience = 'client' and r.published_at is not null
          and p.email_client_reports and c.portal_enabled and c.archived_at is null`,
      [reportId],
    );
    if (!report) return null;
    const contacts = await many<{ id: string; name: string; email: string }>(
      t,
      `select id, name, email from ${S}.client_contacts
        where client_id = $1 and access_status = 'active'
          and consent_at is not null and anonymized_at is null
        order by name`,
      [report.client_id],
    );
    return { report, contacts };
  });
  if (!data) {
    return { status: "skipped", reason: "relatório sem envio por e-mail" };
  }
  const base = appUrl();
  const url = base
    ? `${base}/portal/${data.report.client_slug}/${data.report.project_code}`
    : null;
  let sent = 0;
  let failed = 0;
  for (const contact of data.contacts) {
    const message = reportEmail({
      contactName: contact.name,
      orgName: data.report.org,
      projectName: data.report.project_name,
      periodStart: data.report.period_start,
      periodEnd: data.report.period_end,
      body: data.report.body_md,
      url,
    });
    const result = await sendEmail(
      {
        to: contact.email,
        subject: message.subject,
        text: message.text,
        fromName: data.report.org,
        // Job repetido não manda de novo o mesmo relatório ao mesmo contato.
        idempotencyKey: `${REPORT_EMAIL_JOB}:${reportId}:${contact.id}`,
      },
      { config, fetch: deps.fetch },
    );
    if (result.ok) sent += 1;
    else {
      failed += 1;
      log.warn({ reason: result.reason }, "relatório por e-mail: não saiu");
    }
  }
  await inTx(ctx, (t) =>
    audit(t, {
      action: "report.emailed",
      entityType: "report",
      entityId: reportId,
      projectId: data.report.project_id,
      after: { sent, failed },
    }),
  );
  return { status: "sent", sent, failed };
}
