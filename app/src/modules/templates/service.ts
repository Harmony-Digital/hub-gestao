import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { badRequest, conflict, notFound, unprocessable } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import { authorizeProjectId, iso, Line, Uuid } from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";
import { updateMilestone } from "@/modules/milestones/admin";
import { getMilestone } from "@/modules/milestones/service";
import { getPlan } from "@/modules/projects/service";
import { STATUS_CATEGORIES } from "@/modules/tasks/status-categories";
import { spreadDueDates } from "./dates";
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
 * departamentos do projeto e, quando o modelo sai de um projeto (RF-36), o conjunto de
 * status das tarefas e os textos para o cliente (o objetivo, e o título e a descrição dos
 * marcos e das frentes, pelo título interno). O projeto novo nasce com esses status, e os
 * textos entram depois da importação (`applyTemplateClientTexts`), só onde estão vazios. Usar um modelo é a importação do `plan.md` de sempre, com a
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

export const TemplateStatus = z.object({
  name: Line(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  category: z.enum(STATUS_CATEGORIES),
  is_default: z.boolean(),
});
export type TemplateStatus = z.infer<typeof TemplateStatus>;

const ClientText = z.object({
  title_client: Line(200).nullable(),
  description_client: z.string().trim().max(2000).nullable(),
});

export const TemplateClientTexts = z.object({
  objective: z.string().trim().max(2000).nullable(),
  /** Pelo título interno do marco ou da frente (o código muda de projeto para projeto). */
  milestones: z.record(z.string(), ClientText),
  workstreams: z.record(z.string(), ClientText),
});
export type TemplateClientTexts = z.infer<typeof TemplateClientTexts>;

/** O que fica na coluna `structure` do modelo. */
const Structure = z.object({
  format: z.literal("plan_md"),
  markdown: z.string(),
  departments: z.array(z.string()),
  statuses: z.array(TemplateStatus).nullish(),
  client: TemplateClientTexts.nullish(),
});

export type TemplateDto = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  departments: { slug: string; name: string }[];
  markdown: string;
  counts: TemplateCounts;
  /** Conjunto de status das tarefas (RF-36); null: os status padrão do workspace. */
  statuses: TemplateStatus[] | null;
  /** Textos para o cliente (RF-36); null: nenhum. */
  client: TemplateClientTexts | null;
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
    statuses: (parsed.success && parsed.data.statuses) || null,
    client: (parsed.success && parsed.data.client) || null,
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

const structureOf = (
  input: TemplateInput,
  extras: {
    statuses?: TemplateStatus[] | null;
    client?: TemplateClientTexts | null;
  } = {},
) =>
  json({
    format: "plan_md",
    markdown: input.markdown,
    departments: [...new Set(input.departments)],
    ...(extras.statuses ? { statuses: extras.statuses } : {}),
    ...(extras.client ? { client: extras.client } : {}),
  });

/** O conjunto de status precisa ter as cinco categorias e um padrão em "A fazer". */
function statusesProblem(statuses: TemplateStatus[]): string | null {
  for (const category of STATUS_CATEGORIES) {
    if (!statuses.some((s) => s.category === category)) {
      return "O conjunto de status do modelo precisa ter um status em cada categoria.";
    }
  }
  const defaults = statuses.filter((s) => s.is_default);
  if (defaults.length !== 1 || defaults[0].category !== "todo") {
    return "O conjunto de status do modelo precisa de um status padrão, em A fazer.";
  }
  if (
    new Set(statuses.map((s) => s.name.toLowerCase())).size !== statuses.length
  ) {
    return "O conjunto de status do modelo tem nome repetido.";
  }
  return null;
}

export async function createTemplate(
  t: TxCtx,
  input: TemplateInput,
  extras: {
    statuses?: TemplateStatus[] | null;
    client?: TemplateClientTexts | null;
  } = {},
): Promise<TemplateDto> {
  authorize(t.actor, ADMIN);
  await checkInput(t, input);
  await nameTaken(t, input.name, null);
  if (extras.statuses) {
    const problem = statusesProblem(extras.statuses);
    if (problem) throw unprocessable(problem);
  }
  if (extras.client) assertNoSecrets({ textos: JSON.stringify(extras.client) });
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.project_templates (workspace_id, name, description, structure)
     values ($1, $2, $3, $4::jsonb)
     returning id`,
    [
      t.actor.workspaceId,
      input.name,
      input.description || null,
      structureOf(input, extras),
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
    [
      id,
      input.name,
      input.description || null,
      // Os status e os textos para o cliente do modelo continuam (a tela edita o resto).
      structureOf(input, {
        statuses: current.statuses,
        client: current.client,
      }),
    ],
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
  // RF-36: o conjunto de status e os textos para o cliente do projeto vão junto.
  const ref = await maybeOne<{ id: string; objective_client: string | null }>(
    t,
    `select id, objective_client from ${S}.projects where code = $1`,
    [plan.project.code],
  );
  const statuses = await many<TemplateStatus>(
    t,
    `select name, color, category::text as category, is_default
       from ${S}.task_statuses where project_id = $1
      order by sort_order, name`,
    [ref!.id],
  );
  const texts = async (table: "milestones" | "workstreams") =>
    Object.fromEntries(
      (
        await many<{
          title: string;
          title_client: string | null;
          description_client: string | null;
        }>(
          t,
          `select title, title_client, description_client from ${S}.${table}
            where project_id = $1 and archived_at is null
              and (title_client is not null or description_client is not null)
            order by sort_order`,
          [ref!.id],
        )
      ).map((r) => [
        r.title,
        {
          title_client: r.title_client,
          description_client: r.description_client,
        },
      ]),
    );
  const milestoneTexts = await texts("milestones");
  const workstreamTexts = await texts("workstreams");
  const client =
    ref!.objective_client ||
    Object.keys(milestoneTexts).length ||
    Object.keys(workstreamTexts).length
      ? {
          objective: ref!.objective_client,
          milestones: milestoneTexts,
          workstreams: workstreamTexts,
        }
      : null;
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
    { statuses: statuses.length ? statuses : null, client },
  );
}

/**
 * O projeto novo nasce com o conjunto de status do modelo (RF-36), no lugar dos status
 * padrão: chamado logo depois de criar o projeto, quando ainda não há tarefa.
 */
export async function applyTemplateStatuses(
  t: TxCtx,
  projectId: string,
  statuses: TemplateStatus[],
): Promise<void> {
  authorize(t.actor, ADMIN);
  const problem = statusesProblem(statuses);
  if (problem) throw unprocessable(problem);
  const used = await maybeOne(
    t,
    `select 1 from ${S}.tasks where project_id = $1 limit 1`,
    [projectId],
  );
  if (used) {
    throw conflict(
      "O projeto já tem tarefas: mude os status em Editar projeto.",
    );
  }
  await t.tx.query(`delete from ${S}.task_statuses where project_id = $1`, [
    projectId,
  ]);
  for (const [i, st] of statuses.entries()) {
    await t.tx.query(
      `insert into ${S}.task_statuses
         (workspace_id, project_id, name, color, category, sort_order, is_default)
       values ($1, $2, $3, $4, $5::${S}.status_category, $6, $7)`,
      [
        t.actor.workspaceId,
        projectId,
        st.name,
        st.color.toUpperCase(),
        st.category,
        i + 1,
        st.is_default,
      ],
    );
  }
}

/**
 * Os textos para o cliente do modelo (RF-36), depois da importação: pelo título interno
 * do marco e da frente, só onde o projeto ainda não tem texto para o cliente (nada é
 * sobrescrito; marco aceito não muda). Mostrar a frente ao cliente continua sendo pedido
 * de aprovação. Devolve quantos textos entraram.
 */
export async function applyTemplateClientTexts(
  t: TxCtx,
  projectCode: string,
  templateId: string,
): Promise<number> {
  const template = await getTemplate(t, templateId);
  if (!template.client) return 0;
  const project = await maybeOne<{
    id: string;
    objective_client: string | null;
  }>(t, `select id, objective_client from ${S}.projects where code = $1`, [
    projectCode,
  ]);
  if (!project) throw notFound(`O projeto ${projectCode} não existe.`);
  await authorizeProjectId(t, project.id, "milestone.write");
  const byTitle = (texts: TemplateClientTexts["milestones"]) =>
    new Map(Object.entries(texts).map(([k, v]) => [k.trim().toLowerCase(), v]));
  let applied = 0;
  for (const table of ["milestones", "workstreams"] as const) {
    const texts = byTitle(template.client[table]);
    if (texts.size === 0) continue;
    const rows = await many<{ id: string; title: string }>(
      t,
      `select id, title from ${S}.${table}
        where project_id = $1 and archived_at is null
          and title_client is null and description_client is null
          ${table === "milestones" ? "and status <> 'accepted'" : ""}`,
      [project.id],
    );
    for (const row of rows) {
      const text = texts.get(row.title.trim().toLowerCase());
      if (!text || (!text.title_client && !text.description_client)) continue;
      await t.tx.query(
        `update ${S}.${table} set title_client = $2, description_client = $3
          where id = $1`,
        [row.id, text.title_client, text.description_client],
      );
      await audit(t, {
        action:
          table === "milestones" ? "milestone.updated" : "workstream.updated",
        entityType: table === "milestones" ? "milestone" : "workstream",
        entityId: row.id,
        projectId: project.id,
        before: { title_client: null, description_client: null },
        after: { ...text, from_template: template.name },
      });
      applied += 1;
    }
  }
  return applied;
}

/** Motivo gravado no histórico de datas do marco (interno; o portal não mostra). */
export const TEMPLATE_DATES_REASON =
  "Data inicial distribuída pelo modelo, entre o início e a entrega do projeto.";

/**
 * Depois da importação de um modelo: os marcos sem data recebem datas espalhadas entre
 * o início e a entrega do projeto (`spreadDueDates`), pelo caso de uso de sempre (com o
 * histórico de datas). Sem as duas datas do projeto, nada muda. Devolve quantos mudaram.
 */
export async function applyTemplateDates(
  t: TxCtx,
  projectCode: string,
): Promise<number> {
  const project = await maybeOne<{
    id: string;
    start_date: string | null;
    target_date: string | null;
  }>(
    t,
    `select id, start_date::text as start_date, target_date::text as target_date
       from ${S}.projects where code = $1`,
    [projectCode],
  );
  if (!project) throw notFound(`O projeto ${projectCode} não existe.`);
  await authorizeProjectId(t, project.id, "milestone.write");
  if (!project.start_date || !project.target_date) return 0;
  const undated = await many<{ id: string }>(
    t,
    `select id from ${S}.milestones
      where project_id = $1 and archived_at is null and due_date is null
        and status <> 'accepted'
      order by sort_order, created_at, id`,
    [project.id],
  );
  const dates = spreadDueDates(
    project.start_date,
    project.target_date,
    undated.length,
  );
  for (const [i, row] of undated.entries()) {
    const due = dates[i];
    if (!due) break;
    const m = await getMilestone(t, row.id);
    await updateMilestone(t, row.id, {
      title: m.title,
      title_client: m.title_client,
      description_client: m.description_client,
      due_date: due,
      status: m.status as "planned" | "in_progress" | "delivered",
      visibility: m.visibility,
      acceptance_criteria: m.acceptance_criteria.map((c) => ({
        text: c.text,
        done: c.done,
      })),
      gate_required: m.gate_required,
      date_reason: TEMPLATE_DATES_REASON,
    });
  }
  return Math.min(undated.length, dates.length);
}
