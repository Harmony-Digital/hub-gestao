import { z } from "zod";
import type { Action } from "@/lib/authorize";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
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
import { many, maybeOne, S, type TxCtx } from "@/modules/context";

/** Onde o comentário fica: tarefa, projeto, marco ou frente (um de cada vez). */
export const CommentTarget = z.union([
  z.strictObject({ task: TaskCode }),
  z.strictObject({ project: ProjectCode }),
  z.strictObject({ milestone_id: Uuid }),
  z.strictObject({ workstream_id: Uuid }),
]);
export type CommentTarget = z.infer<typeof CommentTarget>;

export const CreateCommentInput = z.strictObject({ body_md: Text(10000) });

export const CommentDto = z.object({
  id: Uuid,
  project_code: ProjectCode,
  entity_type: z.enum(["project", "milestone", "workstream", "task"]),
  entity_id: Uuid,
  body_md: z.string(),
  visibility: Visibility,
  author: ActorRef,
  acting_role: z.string().nullable(),
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
         c.author_type, c.author_id, c.author_name, c.acting_role, c.created_at, c.edited_at
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
    created_at: iso(r.created_at),
    edited_at: isoOrNull(r.edited_at),
  };
}

export async function listComments(
  t: TxCtx,
  target: CommentTarget,
): Promise<{ items: CommentDto[] }> {
  const where = await resolveTarget(t, target, "comment.read");
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

/** Comentário interno. Texto para o cliente segue outro caminho, com aprovação (PRD §5.2). */
export async function createComment(
  t: TxCtx,
  target: CommentTarget,
  input: { body_md: string },
): Promise<CommentDto> {
  const where = await resolveTarget(t, target, "comment.write");
  assertNoSecrets({ body_md: input.body_md });
  const inserted = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.comments
       (workspace_id, project_id, entity_type, entity_id, body_md, visibility,
        author_type, author_id, author_name, acting_role)
     values ($1, $2, $3, $4, $5, 'internal', $6, $7, $8, $9)
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
    },
  });
  return dto;
}
