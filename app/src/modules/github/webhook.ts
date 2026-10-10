import { createHmac, timingSafeEqual } from "node:crypto";
import { attempt } from "@/modules/attempt";
import { createComment } from "@/modules/comments/service";
import {
  inTx,
  many,
  maybeOne,
  S,
  type Ctx,
  type TxCtx,
} from "@/modules/context";
import { systemActor } from "@/modules/jobs/service";
import { updateTask } from "@/modules/tasks/service";
import type { Db } from "@/lib/db/types";

/**
 * Webhook do GitHub (PRD §8.7, GH-16): commit ou PR que cita `HUB-n` vira comentário na
 * tarefa, com o link e o SHA; "fecha HUB-n" (ou "closes", "fixes", "resolve") que chega
 * no ramo principal, ou num PR mesclado, vira proposta de conclusão: a tarefa vai para
 * "Em revisão", com o commit como evidência sugerida, e uma pessoa ou o Guardião da
 * Qualidade conclui. O webhook nunca conclui sozinho. Age como o sistema (origem webhook).
 */

const SIGNATURE = /^sha256=([0-9a-f]{64})$/;

/** Confere a assinatura `X-Hub-Signature-256` (HMAC-SHA256 do corpo com o segredo). */
export function validSignature(
  secret: string,
  body: string,
  header: string | null,
): boolean {
  const given = SIGNATURE.exec(header?.trim() ?? "")?.[1];
  if (!given) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(given, "hex");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

/** Códigos citados no texto, na ordem, sem repetir. */
export function mentionedCodes(text: string, prefix = "HUB"): string[] {
  const pattern = new RegExp(`\\b${prefix}-\\d{1,9}\\b`, "g");
  return [...new Set(text.match(pattern) ?? [])];
}

/** Códigos que o texto manda fechar ("fecha HUB-12", "closes HUB-12", "fixes: HUB-12"). */
export function closingCodes(text: string, prefix = "HUB"): string[] {
  const pattern = new RegExp(
    `\\b(?:fecha|fechar|fechada|fechado|conclui|resolve|resolvida|resolvido|closes?|closed|fix(?:es|ed)?|resolves?|resolved)\\s*:?\\s+(${prefix}-\\d{1,9})\\b`,
    "gi",
  );
  return [
    ...new Set([...text.matchAll(pattern)].map((m) => m[1].toUpperCase())),
  ];
}

export type GithubOutcome = {
  event: string;
  comments: number;
  proposals: number;
  ignored: boolean;
};

type Commit = { id: string; message: string; url: string };
type PushPayload = {
  ref?: string;
  repository?: { full_name?: string; default_branch?: string };
  commits?: Commit[];
};
type PullRequestPayload = {
  action?: string;
  repository?: { full_name?: string };
  pull_request?: {
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    merged?: boolean;
    merge_commit_sha?: string | null;
  };
};

const firstLine = (text: string) => text.split("\n")[0].trim().slice(0, 200);
const short = (sha: string) => sha.slice(0, 7);

/** Comentário interno, sem repetir o mesmo texto na mesma tarefa (reentregas do GitHub). */
async function comment(t: TxCtx, code: string, body: string): Promise<boolean> {
  const repeated = await many<{ id: string }>(
    t,
    `select c.id from ${S}.comments c
       join ${S}.tasks k on k.id = c.entity_id and c.entity_type = 'task'
      where k.code = $1 and c.body_md = $2
      limit 1`,
    [code, body],
  );
  if (repeated.length > 0) return false;
  const done = await attempt(t, () =>
    createComment(t, { task: code }, { body_md: body }),
  );
  return done.ok;
}

/** Leva a tarefa para "Em revisão" (se ainda não concluída) e explica a proposta. */
async function propose(
  t: TxCtx,
  code: string,
  evidence: string,
): Promise<boolean> {
  const task = await maybeOne<{
    project_id: string;
    status_category: string;
  }>(
    t,
    `select project_id, status_category from ${S}.tasks
      where code = $1 and archived_at is null`,
    [code],
  );
  if (!task || task.status_category === "done") return false;
  const review = await maybeOne<{ name: string }>(
    t,
    `select name from ${S}.task_statuses
      where project_id = $1 and category = 'review'
      order by sort_order limit 1`,
    [task.project_id],
  );
  const body = `Proposta de conclusão pelo GitHub: ${evidence}. Confira e conclua com a evidência (hub task done ${code} --evidence ...) ou pela tela.`;
  const first = await comment(t, code, body);
  if (!first) return false; // a mesma proposta já foi feita
  if (review && task.status_category !== "review") {
    await attempt(t, () => updateTask(t, code, { status: review.name }));
  }
  return true;
}

async function onPush(t: TxCtx, payload: PushPayload, prefix: string) {
  const repo = payload.repository?.full_name ?? "repositório";
  const branch = payload.ref?.replace(/^refs\/heads\//, "") ?? "";
  const main = branch === payload.repository?.default_branch;
  let comments = 0;
  let proposals = 0;
  for (const commit of payload.commits ?? []) {
    const line = `Commit ${short(commit.id)} em ${repo}@${branch}: ${firstLine(commit.message)} (${commit.url})`;
    for (const code of mentionedCodes(commit.message, prefix)) {
      if (await comment(t, code, line)) comments += 1;
    }
    if (!main) continue;
    for (const code of closingCodes(commit.message, prefix)) {
      if (
        await propose(t, code, `commit ${commit.id} em ${repo} (${commit.url})`)
      ) {
        proposals += 1;
      }
    }
  }
  return { comments, proposals };
}

async function onPullRequest(
  t: TxCtx,
  payload: PullRequestPayload,
  prefix: string,
) {
  const pr = payload.pull_request;
  const action = payload.action ?? "";
  if (!pr || !["opened", "edited", "reopened", "closed"].includes(action)) {
    return { comments: 0, proposals: 0, ignored: true };
  }
  const repo = payload.repository?.full_name ?? "repositório";
  const merged = action === "closed" && pr.merged === true;
  const state = merged
    ? "mesclado"
    : action === "closed"
      ? "fechado sem mesclar"
      : "aberto";
  const text = `${pr.title ?? ""}\n${pr.body ?? ""}`;
  const line = `PR #${pr.number} em ${repo} ${state}: ${firstLine(pr.title ?? "")} (${pr.html_url})`;
  let comments = 0;
  let proposals = 0;
  for (const code of mentionedCodes(text, prefix)) {
    if (await comment(t, code, line)) comments += 1;
  }
  if (merged) {
    const sha = pr.merge_commit_sha ? ` (commit ${pr.merge_commit_sha})` : "";
    for (const code of closingCodes(text, prefix)) {
      if (
        await propose(
          t,
          code,
          `PR #${pr.number} mesclado em ${repo}${sha}: ${pr.html_url}`,
        )
      ) {
        proposals += 1;
      }
    }
  }
  return { comments, proposals, ignored: false };
}

/** Trata um evento já autenticado. Eventos que não interessam respondem sem efeito. */
export async function handleGithubEvent(
  db: Db,
  workspaceId: string,
  event: string,
  payload: unknown,
  requestId: string,
): Promise<GithubOutcome> {
  if (event !== "push" && event !== "pull_request") {
    return { event, comments: 0, proposals: 0, ignored: true };
  }
  const ctx: Ctx = {
    db,
    actor: systemActor(workspaceId),
    source: "webhook",
    requestId,
  };
  return inTx(ctx, async (t) => {
    const prefix =
      (
        await maybeOne<{ task_prefix: string }>(
          t,
          `select task_prefix from ${S}.workspaces where id = $1`,
          [workspaceId],
        )
      )?.task_prefix ?? "HUB";
    if (event === "push") {
      const result = await onPush(t, payload as PushPayload, prefix);
      return { event, ...result, ignored: false };
    }
    const result = await onPullRequest(
      t,
      payload as PullRequestPayload,
      prefix,
    );
    return { event, ...result };
  });
}
