import { z } from "zod";
import { audit, changedFields } from "@/lib/audit";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import {
  ACTOR_NAME_SQL,
  actorRef,
  authorizeProjectId,
  iso,
  MilestoneCode,
  ProjectCode,
  resolveAssignee,
  resolveProject,
  Line,
  Uuid,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { emitEvent, recomputeRollup } from "@/modules/events";
import {
  WorkstreamStatus,
  type WorkstreamDto,
} from "@/modules/projects/schemas";
import { AssigneeInput } from "@/modules/tasks/schemas";
import {
  DEPENDS_ON_SQL,
  MAX_WORKSTREAM_DEPENDENCIES,
  replaceWorkstreamDependencies,
} from "./dependencies";

const DepartmentSlug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Departamento pelo slug, como sistemas.");

const DependsOn = z
  .array(Uuid)
  .max(MAX_WORKSTREAM_DEPENDENCIES)
  .describe(
    "Lista completa das frentes de que esta depende (ids de frentes ativas do mesmo projeto). Substitui a anterior; [] tira todas. Sem ciclos.",
  );

/** Frente nova (camada tática). Nasce interna; ir para o cliente passa por aprovação. */
export const CreateWorkstreamInput = z.strictObject({
  project: ProjectCode,
  title: Line(200),
  milestone: MilestoneCode.optional().describe("Código do marco, como M2."),
  department: DepartmentSlug.optional(),
  description_internal: z.string().max(4000).optional(),
  status: WorkstreamStatus.optional(),
  sort_order: z.number().int().optional(),
  assignee: AssigneeInput.optional(),
  depends_on: DependsOn.optional(),
});
export type CreateWorkstreamInput = z.infer<typeof CreateWorkstreamInput>;

export const UpdateWorkstreamInput = z.strictObject({
  title: Line(200).optional(),
  milestone: MilestoneCode.nullable().optional(),
  department: DepartmentSlug.nullable().optional(),
  description_internal: z.string().max(4000).nullable().optional(),
  status: WorkstreamStatus.optional(),
  sort_order: z.number().int().optional(),
  assignee: AssigneeInput.nullable().optional(),
  depends_on: DependsOn.optional(),
});
export type UpdateWorkstreamInput = z.infer<typeof UpdateWorkstreamInput>;

export const WORKSTREAM_SELECT = `
  select w.id, p.code as project_code, w.project_id, m.id as milestone_id, m.code as milestone_code,
         d.slug as department_slug, d.name as department_name, d.color as department_color,
         w.title, w.title_client, w.description_internal, w.description_client, w.visibility,
         w.status, w.sort_order, w.assignee_type, w.assignee_id,
         ${ACTOR_NAME_SQL("w.assignee_type", "w.assignee_id")} as assignee_name,
         w.progress_pct, w.task_count, w.done_count, w.blocked_count, w.updated_at,
         ${DEPENDS_ON_SQL} as depends_on
    from ${S}.workstreams w
    join ${S}.projects p on p.id = w.project_id
    left join ${S}.milestones m on m.id = w.milestone_id
    left join ${S}.departments d on d.id = w.department_id`;

export type WorkstreamRow = {
  id: string;
  project_code: string;
  project_id: string;
  milestone_id: string | null;
  milestone_code: string | null;
  department_slug: string | null;
  department_name: string | null;
  department_color: string | null;
  title: string;
  title_client: string | null;
  description_internal: string | null;
  description_client: string | null;
  visibility: WorkstreamDto["visibility"];
  status: WorkstreamDto["status"];
  sort_order: number;
  assignee_type: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  progress_pct: number;
  task_count: number;
  done_count: number;
  blocked_count: number;
  updated_at: Date | string;
  depends_on: string[] | null;
};

export function toWorkstreamDto(r: WorkstreamRow): WorkstreamDto {
  return {
    id: r.id,
    project_code: r.project_code,
    milestone:
      r.milestone_id && r.milestone_code
        ? { id: r.milestone_id, code: r.milestone_code }
        : null,
    department:
      r.department_slug && r.department_name && r.department_color
        ? {
            slug: r.department_slug,
            name: r.department_name,
            color: r.department_color,
          }
        : null,
    title: r.title,
    title_client: r.title_client,
    description_internal: r.description_internal,
    description_client: r.description_client,
    visibility: r.visibility,
    status: r.status,
    sort_order: r.sort_order,
    assignee: actorRef(r.assignee_type, r.assignee_id, r.assignee_name),
    progress_pct: r.progress_pct,
    task_count: r.task_count,
    done_count: r.done_count,
    blocked_count: r.blocked_count,
    depends_on: r.depends_on ?? [],
    updated_at: iso(r.updated_at),
  };
}

export async function workstreamsOfProject(
  t: TxCtx,
  projectId: string,
): Promise<WorkstreamDto[]> {
  const rows = await many<WorkstreamRow>(
    t,
    `${WORKSTREAM_SELECT}
      where w.project_id = $1 and w.archived_at is null
      order by m.sort_order nulls last, w.sort_order, w.title`,
    [projectId],
  );
  return rows.map(toWorkstreamDto);
}

export async function listWorkstreams(
  t: TxCtx,
  projectCode: string,
): Promise<{ items: WorkstreamDto[] }> {
  const project = await resolveProject(t, projectCode, "workstream.read");
  return { items: await workstreamsOfProject(t, project.id) };
}

async function workstreamById(t: TxCtx, id: string): Promise<WorkstreamRow> {
  const parsed = Uuid.safeParse(id);
  if (!parsed.success) throw badRequest("Id de frente inválido.");
  const row = await maybeOne<WorkstreamRow>(
    t,
    `${WORKSTREAM_SELECT} where w.id = $1`,
    [parsed.data],
  );
  if (!row) throw notFound("Frente não encontrada neste workspace.");
  return row;
}

export async function getWorkstream(
  t: TxCtx,
  id: string,
): Promise<WorkstreamDto> {
  const row = await workstreamById(t, id);
  await authorizeProjectId(t, row.project_id, "workstream.read");
  return toWorkstreamDto(row);
}

async function milestoneId(
  t: TxCtx,
  projectId: string,
  code: string,
): Promise<string> {
  const row = await maybeOne<{ id: string }>(
    t,
    `select id from ${S}.milestones where project_id = $1 and code = $2 and archived_at is null`,
    [projectId, code],
  );
  if (!row) throw unprocessable(`O marco ${code} não existe neste projeto.`);
  return row.id;
}

async function departmentId(t: TxCtx, slug: string): Promise<string> {
  const row = await maybeOne<{ id: string }>(
    t,
    `select id from ${S}.departments where slug = $1`,
    [slug],
  );
  if (!row) {
    const all = await many<{ slug: string }>(
      t,
      `select slug from ${S}.departments order by sort_order`,
    );
    throw unprocessable(
      `Departamento "${slug}" não existe. Opções: ${all.map((d) => d.slug).join(", ")}.`,
    );
  }
  return row.id;
}

export async function createWorkstream(
  t: TxCtx,
  input: CreateWorkstreamInput,
): Promise<WorkstreamDto> {
  const project = await resolveProject(t, input.project, "workstream.write");
  assertNoSecrets({
    title: input.title,
    description_internal: input.description_internal,
  });
  const milestone = input.milestone
    ? await milestoneId(t, project.id, input.milestone)
    : null;
  const department = input.department
    ? await departmentId(t, input.department)
    : null;
  const assignee = input.assignee
    ? await resolveAssignee(t, input.assignee)
    : null;
  const inserted = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.workstreams
       (workspace_id, project_id, milestone_id, department_id, title, description_internal,
        status, sort_order, assignee_type, assignee_id, visibility)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'internal')
     returning id`,
    [
      t.actor.workspaceId,
      project.id,
      milestone,
      department,
      input.title,
      input.description_internal ?? null,
      input.status ?? "planned",
      input.sort_order ?? 0,
      assignee?.type ?? null,
      assignee?.id ?? null,
    ],
  );
  await recomputeRollup(t, project.id);
  let dto = toWorkstreamDto(await workstreamById(t, inserted!.id));
  await audit(t, {
    action: "workstream.created",
    entityType: "workstream",
    entityId: dto.id,
    projectId: project.id,
    after: {
      title: dto.title,
      milestone: dto.milestone?.code ?? null,
      department: dto.department?.slug ?? null,
      status: dto.status,
    },
  });
  if (input.depends_on?.length) {
    await replaceWorkstreamDependencies(
      t,
      { id: dto.id, project_id: project.id },
      input.depends_on,
    );
    dto = toWorkstreamDto(await workstreamById(t, dto.id));
  }
  await emitEvent(t, "workstream.updated", {
    id: dto.id,
    project_code: dto.project_code,
    title: dto.title,
  });
  return dto;
}

const WORKSTREAM_AUDIT_KEYS = [
  "title",
  "milestone",
  "department",
  "description_internal",
  "status",
  "sort_order",
  "assignee",
] as const;

export async function updateWorkstream(
  t: TxCtx,
  id: string,
  input: UpdateWorkstreamInput,
): Promise<WorkstreamDto> {
  const current = await workstreamById(t, id);
  await authorizeProjectId(t, current.project_id, "workstream.write");
  if (Object.keys(input).length === 0) {
    throw badRequest("Nada para atualizar: envie ao menos um campo.");
  }
  const { depends_on: dependsOn, ...fields } = input;
  assertNoSecrets({
    title: fields.title,
    description_internal: fields.description_internal,
  });

  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (fields.title !== undefined) set("title", fields.title);
  if (fields.description_internal !== undefined) {
    set("description_internal", fields.description_internal);
  }
  if (fields.status !== undefined) set("status", fields.status);
  if (fields.sort_order !== undefined) set("sort_order", fields.sort_order);
  if (fields.milestone !== undefined) {
    set(
      "milestone_id",
      fields.milestone
        ? await milestoneId(t, current.project_id, fields.milestone)
        : null,
    );
  }
  if (fields.department !== undefined) {
    set(
      "department_id",
      fields.department ? await departmentId(t, fields.department) : null,
    );
  }
  if (fields.assignee !== undefined) {
    const assignee = fields.assignee
      ? await resolveAssignee(t, fields.assignee)
      : null;
    set("assignee_type", assignee?.type ?? null);
    set("assignee_id", assignee?.id ?? null);
  }
  if (sets.length > 0) {
    params.push(current.id);
    await t.tx.query(
      `update ${S}.workstreams set ${sets.join(", ")} where id = $${params.length}`,
      params,
    );
    await recomputeRollup(t, current.project_id);
  }
  const before = toWorkstreamDto(current);
  let after = toWorkstreamDto(await workstreamById(t, current.id));
  if (sets.length > 0) {
    const flat = (d: WorkstreamDto) => ({
      ...d,
      milestone: d.milestone?.code ?? null,
      department: d.department?.slug ?? null,
      assignee: d.assignee ? `${d.assignee.type}:${d.assignee.id}` : null,
    });
    await audit(t, {
      action: "workstream.updated",
      entityType: "workstream",
      entityId: current.id,
      projectId: current.project_id,
      ...changedFields(flat(before), flat(after), WORKSTREAM_AUDIT_KEYS),
    });
  }
  if (
    dependsOn !== undefined &&
    (await replaceWorkstreamDependencies(t, current, dependsOn))
  ) {
    after = toWorkstreamDto(await workstreamById(t, current.id));
  }
  await emitEvent(t, "workstream.updated", {
    id: after.id,
    project_code: after.project_code,
    status: after.status,
  });
  return after;
}

export const WorkstreamVisibilityInput = z.strictObject({
  visibility: z.enum(["internal", "client"]),
  title_client: Line(200).nullable(),
  description_client: z.string().trim().max(2000).nullable(),
});
export type WorkstreamVisibilityInput = z.infer<
  typeof WorkstreamVisibilityInput
>;

/**
 * Mostra a frente ao cliente (ou volta a esconder), com o título e a descrição escritos
 * para ele. Decisão de pessoa (workstream.visibility): agentes pedem pela aprovação
 * client_visibility, e o dono decide.
 */
export async function setWorkstreamVisibility(
  t: TxCtx,
  id: string,
  input: WorkstreamVisibilityInput,
): Promise<WorkstreamDto> {
  if (!Uuid.safeParse(id).success) throw badRequest("Frente inválida.");
  const current = await workstreamById(t, id);
  await authorizeProjectId(t, current.project_id, "workstream.visibility");
  if (input.visibility === "client" && !input.title_client) {
    throw badRequest(
      "Para mostrar a frente ao cliente, escreva o título que ele vai ver.",
    );
  }
  assertNoSecrets({
    title_client: input.title_client,
    description_client: input.description_client,
  });
  await t.tx.query(
    `update ${S}.workstreams
        set visibility = $2, title_client = $3, description_client = $4
      where id = $1`,
    [
      current.id,
      input.visibility,
      input.title_client,
      input.description_client || null,
    ],
  );
  const before = toWorkstreamDto(current);
  const after = toWorkstreamDto(await workstreamById(t, current.id));
  const changes = changedFields(before, after, [
    "visibility",
    "title_client",
    "description_client",
  ]);
  if (Object.keys(changes.after).length > 0) {
    await audit(t, {
      action: "workstream.visibility_changed",
      entityType: "workstream",
      entityId: current.id,
      projectId: current.project_id,
      ...changes,
    });
    await emitEvent(t, "workstream.updated", {
      id: after.id,
      project_code: after.project_code,
      visibility: after.visibility,
    });
  }
  return after;
}
