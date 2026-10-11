import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { badRequest, conflict, notFound, unprocessable } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import { iso, Line, Uuid } from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";
import { getPlan } from "@/modules/projects/service";
import {
  renderTemplate,
  TEMPLATE_MARKDOWN_MAX,
  templateCounts,
  templateProblem,
  type TemplateCounts,
} from "./markdown";

/**
 * Modelos de projeto (PRD §7.15): esqueletos de marcos, frentes (com o departamento),
 * tarefas e critérios de aceite, guardados no workspace (`project_templates`), mais os
 * departamentos do projeto. Usar um modelo é a importação do `plan.md` de sempre, com a
 * prévia (a pessoa decide o que entra). Criar, editar, remover e gerar a partir de um
 * projeto é do dono e da administração (workspace.admin).
 */

const ADMIN = "workspace.admin";

const DepartmentSlug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Departamento pelo slug, como sistemas.");

export const TemplateInput = z.strictObject({
  name: Line(120),
  description: z.string().trim().max(1000).nullable().optional(),
  markdown: z.string().max(TEMPLATE_MARKDOWN_MAX),
  departments: z.array(DepartmentSlug).max(20).default([]),
});
export type TemplateInput = z.infer<typeof TemplateInput>;

/** O que fica na coluna `structure` do modelo. */
const Structure = z.object({
  format: z.literal("plan_md"),
  markdown: z.string(),
  departments: z.array(z.string()),
});

export type TemplateDto = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  departments: { slug: string; name: string }[];
  markdown: string;
  counts: TemplateCounts;
  updatedAt: string;
};

type Row = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  structure: unknown;
  updated_at: Date | string;
};

async function departmentsBySlug(
  t: TxCtx,
): Promise<Map<string, { slug: string; name: string }>> {
  const rows = await many<{ slug: string; name: string }>(
    t,
    `select slug, name from ${S}.departments order by sort_order`,
  );
  return new Map(rows.map((d) => [d.slug, d]));
}

function toDto(
  row: Row,
  departments: Map<string, { slug: string; name: string }>,
): TemplateDto {
  const parsed = Structure.safeParse(row.structure);
  const markdown = parsed.success ? parsed.data.markdown : "";
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    departments: (parsed.success ? parsed.data.departments : [])
      .map((slug) => departments.get(slug))
      .filter((d): d is { slug: string; name: string } => Boolean(d)),
    markdown,
    counts: templateCounts(markdown),
    updatedAt: iso(row.updated_at),
  };
}

const SELECT = `select id, name, description, version, structure, updated_at
                  from ${S}.project_templates`;

export async function listTemplates(t: TxCtx): Promise<TemplateDto[]> {
  authorize(t.actor, ADMIN);
  const departments = await departmentsBySlug(t);
  const rows = await many<Row>(t, `${SELECT} order by name`);
  return rows.map((r) => toDto(r, departments));
}

export async function getTemplate(t: TxCtx, id: string): Promise<TemplateDto> {
  authorize(t.actor, ADMIN);
  if (!Uuid.safeParse(id).success) throw badRequest("Modelo inválido.");
  const row = await maybeOne<Row>(t, `${SELECT} where id = $1`, [id]);
  if (!row) throw notFound("Modelo não encontrado neste workspace.");
  return toDto(row, await departmentsBySlug(t));
}

async function checkInput(t: TxCtx, input: TemplateInput) {
  assertNoSecrets({
    name: input.name,
    description: input.description,
    markdown: input.markdown,
  });
  const prefix =
    (
      await maybeOne<{ task_prefix: string }>(
        t,
        `select task_prefix from ${S}.workspaces where id = $1`,
        [t.actor.workspaceId],
      )
    )?.task_prefix ?? "HUB";
  const problem = templateProblem(input.markdown, prefix);
  if (problem) throw unprocessable(problem);
  const departments = await departmentsBySlug(t);
  const unknown = input.departments.filter((d) => !departments.has(d));
  if (unknown.length > 0) {
    throw unprocessable(
      `Departamento que não existe: ${unknown.join(", ")}. Opções: ${[...departments.keys()].join(", ")}.`,
    );
  }
}

async function nameTaken(t: TxCtx, name: string, except: string | null) {
  const row = await maybeOne<{ id: string }>(
    t,
    `select id from ${S}.project_templates
      where lower(name) = lower($1) and ($2::uuid is null or id <> $2)`,
    [name, except],
  );
  if (row) throw conflict(`Já existe um modelo chamado “${name}”.`);
}

const structureOf = (input: TemplateInput) =>
  json({
    format: "plan_md",
    markdown: input.markdown,
    departments: [...new Set(input.departments)],
  });

export async function createTemplate(
  t: TxCtx,
  input: TemplateInput,
): Promise<TemplateDto> {
  authorize(t.actor, ADMIN);
  await checkInput(t, input);
  await nameTaken(t, input.name, null);
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.project_templates (workspace_id, name, description, structure)
     values ($1, $2, $3, $4::jsonb)
     returning id`,
    [
      t.actor.workspaceId,
      input.name,
      input.description || null,
      structureOf(input),
    ],
  );
  const dto = await getTemplate(t, row!.id);
  await audit(t, {
    action: "template.created",
    entityType: "template",
    entityId: dto.id,
    after: { name: dto.name, counts: dto.counts },
  });
  return dto;
}

export async function updateTemplate(
  t: TxCtx,
  id: string,
  input: TemplateInput,
): Promise<TemplateDto> {
  const current = await getTemplate(t, id);
  await checkInput(t, input);
  await nameTaken(t, input.name, id);
  const same =
    current.name === input.name &&
    (current.description ?? "") === (input.description ?? "") &&
    current.markdown === input.markdown &&
    current.departments.map((d) => d.slug).join("|") ===
      [...new Set(input.departments)].join("|");
  if (same) return current;
  await t.tx.query(
    `update ${S}.project_templates
        set name = $2, description = $3, structure = $4::jsonb,
            version = version + 1, updated_at = now()
      where id = $1`,
    [id, input.name, input.description || null, structureOf(input)],
  );
  const after = await getTemplate(t, id);
  await audit(t, {
    action: "template.updated",
    entityType: "template",
    entityId: id,
    before: { name: current.name, version: current.version },
    after: { name: after.name, version: after.version, counts: after.counts },
  });
  return after;
}

/** Remove o modelo. O histórico guarda o texto, para dar para refazer. */
export async function removeTemplate(
  t: TxCtx,
  id: string,
): Promise<{ name: string }> {
  const current = await getTemplate(t, id);
  await t.tx.query(`delete from ${S}.project_templates where id = $1`, [id]);
  await audit(t, {
    action: "template.removed",
    entityType: "template",
    entityId: id,
    before: {
      name: current.name,
      version: current.version,
      departments: current.departments.map((d) => d.slug),
      markdown: current.markdown,
    },
  });
  return { name: current.name };
}

/**
 * Modelo a partir de um projeto (RF-37): o esqueleto do plano dele (sem códigos, tudo
 * desmarcado, marcos numerados de novo) e os departamentos do projeto.
 */
export async function templateFromProject(
  t: TxCtx,
  code: string,
  input: { name: string; description?: string | null },
): Promise<TemplateDto> {
  authorize(t.actor, ADMIN);
  const plan = await getPlan(t, code);
  const departments = await departmentsBySlug(t);
  const nameOf = (slug: string | undefined) =>
    slug ? (departments.get(slug)?.name ?? null) : null;
  const toWorkstream = (w: (typeof plan.unplanned.workstreams)[number]) => ({
    title: w.title,
    department: nameOf(w.department?.slug),
    tasks: w.tasks.map((task) => ({
      title: task.title,
      subtasks: task.subtasks.map((s) => s.title),
    })),
  });
  const markdown = renderTemplate({
    name: input.name,
    milestones: plan.milestones.map((m) => ({
      title: m.title,
      criteria: m.acceptance_criteria.map((c) => c.text),
      workstreams: m.workstreams.map(toWorkstream),
    })),
    unplanned: {
      workstreams: plan.unplanned.workstreams.map(toWorkstream),
      tasks: plan.unplanned.tasks.map((task) => ({
        title: task.title,
        subtasks: task.subtasks.map((s) => s.title),
      })),
    },
  });
  const projectDepartments = await many<{ slug: string }>(
    t,
    `select d.slug from ${S}.project_departments pd
       join ${S}.departments d on d.id = pd.department_id
       join ${S}.projects p on p.id = pd.project_id
      where p.code = $1
      order by d.sort_order`,
    [plan.project.code],
  );
  return createTemplate(
    t,
    TemplateInput.parse({
      name: input.name,
      description: input.description ?? null,
      markdown,
      departments: projectDepartments.map((d) => d.slug),
    }),
  );
}
