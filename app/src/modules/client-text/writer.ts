import { z } from "zod";
import { audit } from "@/lib/audit";
import { generateObject, type LlmDeps } from "@/lib/llm";
import { promptTag } from "@/modules/agents/prompts";
import { CLIENT_WRITER } from "@/modules/agents/prompts/client-writer";
import {
  inTx,
  json,
  maybeOne,
  S,
  type Ctx,
  type TxCtx,
} from "@/modules/context";
import {
  checkClientText,
  describeIssue,
  type ClientTextContext,
  type ClientTextIssue,
} from "./check";
import { clientTextContext } from "./context";

/**
 * RC-12 Redator do Cliente (AGENTES.md), a reescrita: depois que um agente propõe um texto
 * para o cliente (rascunho de status ou frente que vai ao portal), um job reescreve no tom
 * Harmony com a IA do agente que tem o papel RC-12 e atualiza o pedido de aprovação. O
 * texto original fica guardado; a verificação em código roda de novo no texto novo; a
 * decisão continua do Fábio. A chamada à IA fica fora das transações. Sem agente RC-12,
 * sem IA ou com qualquer falha, o pedido segue como estava (falha fechada).
 */

export const CLIENT_WRITER_ROLE = "RC-12";
export const REWRITE_JOB = "client-text-rewrite";

export const RewriteOutput = z.object({
  text: z
    .string()
    .nullable()
    .describe("Relatório reescrito, em Markdown simples (só para relatório)."),
  title: z
    .string()
    .nullable()
    .describe("Título da frente para o cliente (só para frente)."),
  description: z
    .string()
    .nullable()
    .describe("Descrição da frente para o cliente, ou null (só para frente)."),
  notes: z
    .string()
    .nullable()
    .describe("O que mudou, em uma ou duas frases, ou null."),
});
export type RewriteOutput = z.infer<typeof RewriteOutput>;

/** O agente do Redator do Cliente: ativo, com o papel RC-12 e com IA configurada. */
export async function writerAgent(
  t: TxCtx,
): Promise<{ id: string; name: string } | null> {
  return maybeOne<{ id: string; name: string }>(
    t,
    `select id, name from ${S}.agents
      where workspace_id = $1 and status = 'active' and $2 = any(roles)
        and llm_provider is not null and llm_model is not null
        and llm_credential_id is not null and budget_usd_month > 0
      order by (kind = 'internal') desc, created_at
      limit 1`,
    [t.actor.workspaceId, CLIENT_WRITER_ROLE],
  );
}

/**
 * Põe a reescrita na fila, se houver Redator do Cliente ligado. Chamado na mesma
 * transação que cria o pedido; o job roda depois (relógio de 5 em 5 minutos).
 */
export async function enqueueClientRewrite(
  t: TxCtx,
  approvalId: string,
): Promise<boolean> {
  if (!(await writerAgent(t))) return false;
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
      REWRITE_JOB,
      json({ approval_id: approvalId }),
      `${REWRITE_JOB}:${approvalId}`,
    ],
  );
  return row !== null;
}

type Kind = "report" | "workstream";

type Prepared = {
  kind: Kind;
  approvalId: string;
  agentId: string;
  project: { id: string; code: string; name: string; client: string };
  period: { start: string; end: string } | null;
  report: { id: string; version: number } | null;
  original: {
    text: string | null;
    title: string | null;
    description: string | null;
  };
  issues: ClientTextIssue[];
  context: ClientTextContext;
};

/** A mensagem para a IA: o tipo, o projeto, os pontos da verificação e o texto. */
export function writerMessage(p: Prepared): string {
  const lines = [
    `TIPO: ${p.kind === "report" ? "relatório" : "frente"}`,
    `PROJETO: ${p.project.name} (cliente: ${p.project.client})`,
  ];
  if (p.period) lines.push(`PERÍODO: ${p.period.start} a ${p.period.end}`);
  lines.push(
    "PONTOS DA VERIFICAÇÃO:",
    ...(p.issues.length
      ? p.issues.map((i) => `- ${describeIssue(i)}`)
      : ["- nenhum"]),
    "",
    "TEXTO ORIGINAL:",
  );
  if (p.kind === "report") {
    lines.push(p.original.text ?? "");
  } else {
    lines.push(`Título: ${p.original.title ?? ""}`);
    lines.push(`Descrição: ${p.original.description ?? "(sem descrição)"}`);
  }
  return lines.join("\n");
}

export type RewriteResult =
  | { status: "rewritten"; issues: number }
  | { status: "skipped"; reason: string };

/** O job: reescreve o texto do pedido e atualiza o pedido, se ainda estiver pendente. */
export async function rewriteForClient(
  ctx: Ctx,
  approvalId: string,
  deps: LlmDeps = {},
): Promise<RewriteResult> {
  const prepared = await inTx(ctx, (t) => prepare(t, approvalId));
  if ("skip" in prepared) return { status: "skipped", reason: prepared.skip };

  const answer = await generateObject(
    ctx,
    {
      agentId: prepared.agentId,
      purpose: `Redator do Cliente · ${promptTag(CLIENT_WRITER)} · ${prepared.project.code}`,
      projectId: prepared.project.id,
      instructions: CLIENT_WRITER.instructions,
      prompt: writerMessage(prepared),
      maxOutputTokens: 3000,
      schema: RewriteOutput,
      schemaName: "texto_para_o_cliente",
      schemaDescription:
        "O texto reescrito no tom Harmony e uma nota curta sobre o que mudou.",
    },
    deps,
  );
  if (!answer.ok) return { status: "skipped", reason: answer.reason };
  const out = answer.object;
  const text = out.text?.trim() || null;
  const title = out.title?.replace(/\s+/g, " ").trim() || null;
  const description = out.description?.trim() || null;
  if (prepared.kind === "report" ? !text : !title) {
    return { status: "skipped", reason: "resposta sem o texto" };
  }
  if (
    (text && text.length > 20000) ||
    (title && title.length > 200) ||
    (description && description.length > 2000)
  ) {
    return { status: "skipped", reason: "resposta longa demais" };
  }
  const issues = [text, title, description]
    .filter((v): v is string => Boolean(v))
    .flatMap((v) => checkClientText(v, prepared.context));
  const unique = [
    ...new Map(issues.map((i) => [`${i.kind}:${i.term}`, i])).values(),
  ];
  return inTx(ctx, (t) =>
    apply(t, prepared, {
      text,
      title,
      description,
      notes: out.notes?.trim() || null,
      issues: unique,
    }),
  );
}

async function prepare(
  t: TxCtx,
  approvalId: string,
): Promise<Prepared | { skip: string }> {
  const a = await maybeOne<{
    type: string;
    status: string;
    entity_id: string | null;
    payload: Record<string, unknown>;
    project_id: string;
    project_code: string;
    project_name: string;
    client_name: string;
  }>(
    t,
    `select a.type, a.status::text as status, a.entity_id, a.payload,
            p.id as project_id, p.code as project_code, p.name as project_name,
            c.name as client_name
       from ${S}.approvals a
       join ${S}.projects p on p.id = a.project_id
       join ${S}.clients c on c.id = p.client_id
      where a.id = $1`,
    [approvalId],
  );
  if (!a) return { skip: "pedido não encontrado" };
  if (a.status !== "pending") return { skip: "pedido já decidido" };
  if (a.payload.rewritten_by) return { skip: "já reescrito" };
  const agent = await writerAgent(t);
  if (!agent) return { skip: "sem Redator do Cliente ligado" };
  const project = {
    id: a.project_id,
    code: a.project_code,
    name: a.project_name,
    client: a.client_name,
  };
  const context = await clientTextContext(t, project.id);

  if (a.type === "status_report") {
    const r = await maybeOne<{
      id: string;
      body_md: string;
      version: number;
      period_start: string;
      period_end: string;
      audience: string;
    }>(
      t,
      `select id, body_md, version, period_start::text as period_start,
              period_end::text as period_end, audience::text as audience
         from ${S}.status_reports where id = $1`,
      [a.entity_id],
    );
    if (!r || r.audience !== "client") return { skip: "não é para o cliente" };
    return {
      kind: "report",
      approvalId,
      agentId: agent.id,
      project,
      period: { start: r.period_start, end: r.period_end },
      report: { id: r.id, version: r.version },
      original: { text: r.body_md, title: null, description: null },
      issues: checkClientText(r.body_md, context),
      context,
    };
  }
  if (a.type === "client_visibility") {
    const title =
      typeof a.payload.title_client === "string"
        ? a.payload.title_client
        : null;
    const description =
      typeof a.payload.description_client === "string"
        ? a.payload.description_client
        : null;
    if (!title) return { skip: "pedido sem título para o cliente" };
    return {
      kind: "workstream",
      approvalId,
      agentId: agent.id,
      project,
      period: null,
      report: null,
      original: { text: null, title, description },
      issues: [title, description]
        .filter((v): v is string => Boolean(v))
        .flatMap((v) => checkClientText(v, context)),
      context,
    };
  }
  return { skip: "tipo de pedido sem texto para o cliente" };
}

async function apply(
  t: TxCtx,
  p: Prepared,
  out: {
    text: string | null;
    title: string | null;
    description: string | null;
    notes: string | null;
    issues: ClientTextIssue[];
  },
): Promise<RewriteResult> {
  // O pedido pode ter sido decidido enquanto a IA escrevia: aí nada muda.
  const current = await maybeOne<{
    status: string;
    payload: Record<string, unknown>;
    summary: string | null;
  }>(
    t,
    `select status::text as status, payload, summary from ${S}.approvals
      where id = $1 for update`,
    [p.approvalId],
  );
  if (
    !current ||
    current.status !== "pending" ||
    current.payload.rewritten_by
  ) {
    return { status: "skipped", reason: "pedido mudou enquanto a IA escrevia" };
  }
  const checks = out.issues.map(({ kind, term }) => ({ kind, term }));
  const note = `Reescrito pelo Redator do Cliente (RC-12)${
    out.issues.length
      ? `; a verificação ainda achou ${out.issues.length === 1 ? "1 ponto" : `${out.issues.length} pontos`} para revisar`
      : ""
  }.`;

  if (p.kind === "report" && p.report && out.text) {
    // Versão nova do relatório, do Redator; a do autor original fica guardada.
    const version = (await maybeOne<{ v: number }>(
      t,
      `select max(version)::int as v from ${S}.status_reports
          where project_id = $1 and period_start = $2 and period_end = $3
            and audience = 'client'`,
      [p.project.id, p.period!.start, p.period!.end],
    ))!.v;
    const report = await maybeOne<{ id: string }>(
      t,
      `insert into ${S}.status_reports
         (workspace_id, project_id, period_start, period_end, audience, body_md,
          generated_by_agent_id, approval_id, version)
       values ($1, $2, $3, $4, 'client', $5, $6, $7, $8)
       returning id`,
      [
        t.actor.workspaceId,
        p.project.id,
        p.period!.start,
        p.period!.end,
        out.text,
        p.agentId,
        p.approvalId,
        version + 1,
      ],
    );
    await t.tx.query(
      `update ${S}.approvals
          set entity_id = $2, payload = payload || $3::jsonb, summary = $4
        where id = $1`,
      [
        p.approvalId,
        report!.id,
        json({
          report_body: out.text,
          original_body: p.original.text,
          checks,
          rewritten_by: CLIENT_WRITER_ROLE,
          rewrite_notes: out.notes,
        }),
        `Versão ${version + 1}, ${note} A versão ${p.report.version}, de quem preparou, fica guardada. Aprovar publica o relatório no portal do cliente.`,
      ],
    );
  } else if (p.kind === "workstream" && out.title) {
    await t.tx.query(
      `update ${S}.approvals
          set payload = payload || $2::jsonb,
              summary = concat_ws(' ', summary, $3::text)
        where id = $1`,
      [
        p.approvalId,
        json({
          title_client: out.title,
          description_client: out.description,
          original_title_client: p.original.title,
          original_description_client: p.original.description,
          checks,
          rewritten_by: CLIENT_WRITER_ROLE,
          rewrite_notes: out.notes,
        }),
        note,
      ],
    );
  } else {
    return { status: "skipped", reason: "resposta sem o texto" };
  }
  await audit(t, {
    action: "approval.rewritten",
    entityType: "approval",
    entityId: p.approvalId,
    projectId: p.project.id,
    after: { by: CLIENT_WRITER_ROLE, issues: out.issues.length },
  });
  return { status: "rewritten", issues: out.issues.length };
}
