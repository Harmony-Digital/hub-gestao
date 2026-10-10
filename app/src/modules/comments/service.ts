import { z } from "zod";
import type { Action } from "@/lib/authorize";
import { audit } from "@/lib/audit";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import {
  actorRef,
  ActorRef,
  authorizeProjectId,
  iso,
  isoOrNull,
  ProjectCode,
  resolveProject,
  TaskCode,
  Text,
  Timestamp,
  Uuid,
  Visibility,
} from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";
import { notifyProfile } from "@/modules/notifications";

/** Onde o comentário fica: tarefa, projeto, marco ou frente (um de cada vez). */
export const CommentTarget = z.union([
  z.strictObject({ task: TaskCode }),
  z.strictObject({ project: ProjectCode }),
  z.strictObject({ milestone_id: Uuid }),
  z.strictObject({ workstream_id: Uuid }),
]);
export type CommentTarget = z.infer<typeof CommentTarget>;

/** Pessoa ou agente citado com @ no comentário. */
export const MentionInput = z.strictObject({
  type: z.enum(["user", "agent"]),
  id: Uuid,
});
export type MentionInput = z.infer<typeof MentionInput>;

export const CreateCommentInput = z.strictObject({
  body_md: Text(10000),
  mentions: z
    .array(MentionInput)
    .max(10)
    .optional()
    .describe(
      "Pessoas ou agentes citados com @ no texto. As pessoas recebem aviso na caixa de entrada.",
    ),
});

export const CommentDto = z.object({
  id: Uuid,
  project_code: ProjectCode,
  entity_type: z.enum(["project", "milestone", "workstream", "task"]),
  entity_id: Uuid,
  body_md: z.string(),
  visibility: Visibility,
  author: ActorRef,
  acting_role: z.string().nullable(),
  mentions: z.array(
    z.object({
      type: z.enum(["user", "agent"]),
      id: Uuid,
      name: z.string(),
    }),
  ),
  created_at: Timestamp,
  edited_at: Timestamp.nullable(),
});
export type CommentDto = z.infer<typeof CommentDto>;

export const CommentList = z.object({ items: z.array(CommentDto) });

type Target = {
  entityType: CommentDto["entity_type"];
  entityId: string;
  projectId: string;
};

async function resolveTarget(
  t: TxCtx,
  target: CommentTarget,
  action: Action,
): Promise<Target> {
  let found: Target | null = null;
  if ("project" in target) {
    const project = await resolveProject(t, target.project, action);
    return {
      entityType: "project",
      entityId: project.id,
      projectId: project.id,
    };
  }
  if ("task" in target) {
    const row = await maybeOne<{ id: string; project_id: string }>(
      t,
      `select id, project_id from ${S}.tasks where code = $1`,
      [target.task],
    );
    if (!row)
      throw notFound(`Tarefa ${target.task} não encontrada neste workspace.`);
    found = { entityType: "task", entityId: row.id, projectId: row.project_id };
  } else if ("milestone_id" in target) {
    const row = await maybeOne<{ id: string; project_id: string }>(
      t,
      `select id, project_id from ${S}.milestones where id = $1`,
      [target.milestone_id],
    );
    if (!row) throw notFound("Marco não encontrado neste workspace.");
    found = {
      entityType: "milestone",
      entityId: row.id,
      projectId: row.project_id,
    };
  } else if ("workstream_id" in target) {
    const row = await maybeOne<{ id: string; project_id: string }>(
      t,
      `select id, project_id from ${S}.workstreams where id = $1`,
      [target.workstream_id],
    );
    if (!row) throw notFound("Frente não encontrada neste workspace.");
    found = {
      entityType: "workstream",
      entityId: row.id,
      projectId: row.project_id,
    };
  }
  if (!found)
    throw badRequest(
      "Indique onde comentar: task, project, milestone_id ou workstream_id.",
    );
  await authorizeProjectId(t, found.projectId, action);
  return found;
}

const COMMENT_SELECT = `
  select c.id, p.code as project_code, c.entity_type, c.entity_id, c.body_md, c.visibility,
         c.author_type, c.author_id, c.author_name, c.acting_role, c.mentions,
         c.created_at, c.edited_at
    from ${S}.comments c
    join ${S}.projects p on p.id = c.project_id`;

type CommentRow = {
  id: string;
  project_code: string;
  entity_type: CommentDto["entity_type"];
  entity_id: string;
  body_md: string;
  visibility: CommentDto["visibility"];
  author_type: string;
  author_id: string | null;
  author_name: string;
  acting_role: string | null;
  mentions: CommentDto["mentions"] | null;
  created_at: Date | string;
  edited_at: Date | string | null;
};

function toCommentDto(r: CommentRow): CommentDto {
  return {
    id: r.id,
    project_code: r.project_code,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    body_md: r.body_md,
    visibility: r.visibility,
    author: actorRef(r.author_type, r.author_id, r.author_name)!,
    acting_role: r.acting_role,
    mentions: Array.isArray(r.mentions) ? r.mentions : [],
    created_at: iso(r.created_at),
    edited_at: isoOrNull(r.edited_at),
  };
}

export async function listComments(
  t: TxCtx,
  target: CommentTarget,
): Promise<{ items: CommentDto[] }> {
  // Comentário de tarefa se lê com a leitura de tarefas; o resto, com a de projetos.
  const where = await resolveTarget(
    t,
    target,
    "task" in target ? "task.read" : "comment.read",
  );
  const rows = await many<CommentRow>(
    t,
    `${COMMENT_SELECT}
      where c.entity_type = $1 and c.entity_id = $2
      order by c.created_at, c.id
      limit 500`,
    [where.entityType, where.entityId],
  );
  return { items: rows.map(toCommentDto) };
}

/** Confere os citados: pessoas ativas do workspace e agentes não revogados. */
async function resolveMentions(
  t: TxCtx,
  mentions: MentionInput[],
): Promise<CommentDto["mentions"]> {
  const unique = [
    ...new Map(mentions.map((m) => [`${m.type}:${m.id}`, m])).values(),
  ];
  const users = unique.filter((m) => m.type === "user").map((m) => m.id);
  const agents = unique.filter((m) => m.type === "agent").map((m) => m.id);
  const found = [
    ...(users.length
      ? await many<{ id: string; name: string }>(
          t,
          `select p.id, p.full_name as name
             from ${S}.profiles p
             join ${S}.memberships m on m.profile_id = p.id
            where p.id = any($1::uuid[]) and m.workspace_id = $2
              and m.status = 'active' and p.deactivated_at is null`,
          [users, t.actor.workspaceId],
        )
      : []
    ).map((r) => ({ type: "user" as const, ...r })),
    ...(agents.length
      ? await many<{ id: string; name: string }>(
          t,
          `select id, name from ${S}.agents
            where id = any($1::uuid[]) and status <> 'revoked'`,
          [agents],
        )
      : []
    ).map((r) => ({ type: "agent" as const, ...r })),
  ];
  if (found.length !== unique.length) {
    throw unprocessable(
      "Alguém citado com @ não faz mais parte do workspace. Recarregue e cite de novo.",
    );
  }
  return found;
}

/** Trecho curto do comentário, sem as marcas do Markdown, para o aviso. */
export function excerpt(body: string, max = 140): string {
  const flat = body
    .replace(/[*_`>#~[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Comentário interno. Texto para o cliente segue outro caminho, com aprovação (PRD §5.2). */
export async function createComment(
  t: TxCtx,
  target: CommentTarget,
  input: { body_md: string; mentions?: MentionInput[] },
): Promise<CommentDto> {
  const where = await resolveTarget(t, target, "comment.write");
  assertNoSecrets({ body_md: input.body_md });
  const mentions = input.mentions?.length
    ? await resolveMentions(t, input.mentions)
    : [];
  const inserted = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.comments
       (workspace_id, project_id, entity_type, entity_id, body_md, visibility,
        author_type, author_id, author_name, acting_role, mentions)
     values ($1, $2, $3, $4, $5, 'internal', $6, $7, $8, $9, $10::jsonb)
     returning id`,
    [
      t.actor.workspaceId,
      where.projectId,
      where.entityType,
      where.entityId,
      input.body_md,
      t.actor.type,
      t.actor.id,
      t.actor.name,
      t.actor.actingRole ?? null,
      json(mentions),
    ],
  );
  const dto = toCommentDto(
    (await maybeOne<CommentRow>(t, `${COMMENT_SELECT} where c.id = $1`, [
      inserted!.id,
    ]))!,
  );
  await audit(t, {
    action: "comment.created",
    entityType: "comment",
    entityId: dto.id,
    projectId: where.projectId,
    after: {
      entity_type: dto.entity_type,
      entity_id: dto.entity_id,
      visibility: "internal",
      ...(mentions.length ? { mentions: mentions.map((m) => m.name) } : {}),
    },
  });
  for (const m of mentions) {
    if (m.type !== "user") continue;
    await notifyProfile(
      t,
      m.id,
      "mention",
      { type: where.entityType, id: where.entityId },
      {
        author: t.actor.name,
        project_code: dto.project_code,
        task_code: "task" in target ? target.task : null,
        comment_id: dto.id,
        excerpt: excerpt(input.body_md),
      },
    );
  }
  return dto;
}
