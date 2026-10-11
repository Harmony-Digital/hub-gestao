import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import type { UserActor } from "@/lib/db/actor";
import {
  badRequest,
  notFound,
  tooManyRequests,
  unprocessable,
} from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import {
  Line,
  ProjectCode,
  projectScopeSql,
  resolveProject,
  Uuid,
} from "@/modules/common";
import { maybeOne, S, type TxCtx } from "@/modules/context";
import { notifyOwners, notifyProfile } from "@/modules/notifications";

/**
 * Aviso de agente na caixa de entrada (PRD §5.3): o digest matinal, os lembretes e os
 * alertas que os agentes também mandam pelo Telegram chegam no Hub. O agente avisa os
 * donos ou uma pessoa da equipe (que enxergue o projeto citado). Escopo `comments:write`
 * (é comunicação interna, como o comentário). Até 30 avisos por agente em 24 horas, e a
 * mesma `dedupe_key` não repete em 24 horas.
 */

export const NOTICE_DAILY_LIMIT = 30;

export const AgentNoticeInput = z.strictObject({
  to: z
    .union([z.literal("owners"), Uuid])
    .default("owners")
    .describe(
      '"owners" (os donos do workspace) ou o id de uma pessoa da equipe (vem do hub_search).',
    ),
  title: Line(140).describe("Uma linha: o que a pessoa precisa saber."),
  body: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .describe("Detalhe em texto (o digest, a lista de bloqueios)."),
  project: ProjectCode.optional().describe(
    "Projeto do aviso, quando houver: o aviso leva a ele.",
  ),
  link: z
    .string()
    .trim()
    .max(300)
    .regex(/^\/(?!\/)[^\s]*$/, "Link interno do Hub, começando com /.")
    .optional()
    .describe("Tela do Hub para onde o aviso leva (ex.: /aprovacoes)."),
  dedupe_key: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Mesma chave em 24 horas não gera aviso de novo (ex.: digest-2026-10-12).",
    ),
});
export type AgentNoticeInput = z.input<typeof AgentNoticeInput>;

export const AgentNoticeResult = z.object({
  sent: z.number().int().describe("Quantas pessoas receberam."),
  deduplicated: z
    .boolean()
    .describe("A mesma dedupe_key já tinha saído nas últimas 24 horas."),
});
export type AgentNoticeResult = z.infer<typeof AgentNoticeResult>;

export async function postAgentNotice(
  t: TxCtx,
  raw: AgentNoticeInput,
): Promise<AgentNoticeResult> {
  if (t.actor.type !== "agent") {
    throw badRequest(
      "Aviso na caixa de entrada é de agente. Pessoas comentam ou mencionam.",
    );
  }
  authorize(t.actor, "comment.write");
  const input = AgentNoticeInput.parse(raw);
  assertNoSecrets({ title: input.title, body: input.body });
  const agentId = t.actor.id;
  const project = input.project
    ? await resolveProject(t, input.project, "comment.write")
    : null;

  if (input.dedupe_key) {
    const seen = await maybeOne(
      t,
      `select 1 from ${S}.activity_log
        where action = 'agent.notice_sent' and actor_type = 'agent' and actor_id = $1
          and after->>'dedupe_key' = $2 and created_at > now() - interval '24 hours'`,
      [agentId, input.dedupe_key],
    );
    if (seen) return { sent: 0, deduplicated: true };
  }
  const recent = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.activity_log
      where action = 'agent.notice_sent' and actor_type = 'agent' and actor_id = $1
        and created_at > now() - interval '24 hours'`,
    [agentId],
  );
  if ((recent?.n ?? 0) >= NOTICE_DAILY_LIMIT) {
    throw tooManyRequests(
      `Este agente já mandou ${NOTICE_DAILY_LIMIT} avisos nas últimas 24 horas. Junte os avisos num só (o digest).`,
      3600,
    );
  }

  const agent = await maybeOne<{ name: string }>(
    t,
    `select name from ${S}.agents where id = $1`,
    [agentId],
  );
  const payload = {
    title: input.title,
    body: input.body || null,
    agent_name: agent?.name ?? null,
    project_code: project?.code ?? null,
    link: input.link ?? null,
  };
  const entity = project
    ? { type: "project", id: project.id }
    : { type: "agent", id: agentId };

  if (input.to === "owners") {
    await notifyOwners(t, "agent.notice", entity, payload);
  } else {
    const member = await maybeOne<{ role: UserActor["role"] }>(
      t,
      `select m.role::text as role from ${S}.memberships m
         join ${S}.profiles p on p.id = m.profile_id
        where m.profile_id = $1 and m.status = 'active' and p.deactivated_at is null`,
      [input.to],
    );
    if (!member) throw notFound("Essa pessoa não está na equipe ativa.");
    if (project) {
      // Quem recebe precisa enxergar o projeto citado (equipe comum: só os dela).
      const recipient: UserActor = {
        type: "user",
        id: input.to,
        scope: "internal",
        role: member.role,
        workspaceId: t.actor.workspaceId,
        name: "",
      };
      const params: unknown[] = [project.id];
      const sees = await maybeOne(
        t,
        `select 1 from ${S}.projects p
          where p.id = $1 and ${projectScopeSql(recipient, "p.id", params)}`,
        params,
      );
      if (!sees) {
        throw unprocessable(
          `Essa pessoa não participa do projeto ${project.code}: avise quem participa, ou os donos.`,
        );
      }
    }
    await notifyProfile(t, input.to, "agent.notice", entity, payload);
  }
  // Quem desligou o grupo Agentes nas preferências não recebe: conta o que entrou agora.
  const sent =
    (
      await maybeOne<{ n: number }>(
        t,
        `select count(*)::int as n from ${S}.notifications
          where type = 'agent.notice' and entity_id = $1 and created_at = now()`,
        [entity.id],
      )
    )?.n ?? 0;

  await audit(t, {
    action: "agent.notice_sent",
    entityType: "agent",
    entityId: agentId,
    projectId: project?.id,
    after: {
      to: input.to,
      title: input.title,
      project_code: project?.code ?? null,
      dedupe_key: input.dedupe_key ?? null,
    },
  });
  return { sent, deduplicated: false };
}
