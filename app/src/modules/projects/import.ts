import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { badRequest, conflict, unprocessable } from "@/lib/errors";
import { PROJECT_STATUS } from "@/lib/labels";
import { assertNoSecrets } from "@/lib/text-guards";
import { requestImportReview } from "@/modules/approvals/service";
import { IsoDate, Line, ProjectCode } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import {
  ImportPlanInput,
  importPlan,
  type ImportPlanResult,
} from "@/modules/sync/service";
import {
  clientById,
  freeSlug,
  ProjectUrl,
  setDepartments,
  slugify,
  type ClientDto,
} from "./admin";
import { ProjectPhase, type ProjectDetail } from "./schemas";
import { getProject } from "./service";

/**
 * Importação de projetos por agente (D10, PRD RF-40; ferramentas hub_create_client,
 * hub_create_project e hub_import_plan, escopo projects:import). O agente cadastra o
 * cliente (sem portal), o projeto em revisão e importa o plan.md; o projeto só passa a
 * valer com o ok do Fábio, no pedido import_review (Hoje, um a um ou em lote). O banco tem
 * a mesma regra (migração 0009): agente só cria projeto em revisão e marco em projeto em
 * revisão. Tudo é idempotente pelo nome do cliente e pelo código do projeto: repetir a
 * importação não duplica nada.
 */

const DEPARTMENT_SLUG = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const ImportClientInput = z.strictObject({
  name: Line(160).describe("Nome do cliente, como a Harmony o chama."),
  segment: Line(120).optional().describe("Segmento (ex.: clínica, ótica)."),
  notes_internal: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .describe(
      "Notas internas sobre o cliente. Nunca segredos nem dados pessoais (CPF, telefone, endereço).",
    ),
});
export type ImportClientInput = z.infer<typeof ImportClientInput>;

/** Cadastra o cliente (sem acesso ao portal) ou devolve o que já existe com o mesmo nome. */
export async function importClient(
  t: TxCtx,
  raw: z.input<typeof ImportClientInput>,
): Promise<{ client: ClientDto; created: boolean }> {
  authorize(t.actor, "project.import");
  const input = ImportClientInput.parse(raw);
  assertNoSecrets({ name: input.name, notes_internal: input.notes_internal });
  const existing = await maybeOne<{ id: string }>(
    t,
    `select id from ${S}.clients
      where workspace_id = $1 and archived_at is null
        and (lower(name) = lower($2) or slug = $3)
      order by created_at limit 1`,
    [t.actor.workspaceId, input.name, slugify(input.name)],
  );
  if (existing) {
    return { client: await clientById(t, existing.id), created: false };
  }
  const slug = await freeSlug(t, slugify(input.name));
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.clients (workspace_id, slug, name, segment, notes_internal)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      t.actor.workspaceId,
      slug,
      input.name,
      input.segment ?? null,
      input.notes_internal || null,
    ],
  );
  const client = await clientById(t, row!.id);
  await audit(t, {
    action: "client.created",
    entityType: "client",
    entityId: client.id,
    after: {
      name: client.name,
      slug: client.slug,
      segment: client.segment,
      via: "importação",
    },
  });
  return { client, created: true };
}

export const ImportProjectInput = z.strictObject({
  client: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .describe("Slug ou nome do cliente (o de hub_create_client)."),
  code: ProjectCode.describe(
    "Código do projeto: de 2 a 8 letras maiúsculas ou números, único no Hub (ex.: CER).",
  ),
  name: Line(160),
  phase: ProjectPhase.optional().describe(
    "Fase do Modelo de Gestão: descobrir, validar ou escalar (padrão: descobrir).",
  ),
  objective_internal: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .describe(
      "Objetivo do projeto, para a equipe (nunca texto para o cliente).",
    ),
  start_date: IsoDate.optional(),
  target_date: IsoDate.optional(),
  repo_url: ProjectUrl.optional().describe(
    "Repositório no GitHub (https://github.com/...), se houver.",
  ),
  plan_path: Line(300)
    .optional()
    .describe("Caminho do plan.md no repositório (ex.: PLAN.md)."),
  departments: z
    .array(DEPARTMENT_SLUG)
    .max(20)
    .optional()
    .describe("Slugs dos departamentos envolvidos (veja hub_whoami)."),
});
export type ImportProjectInput = z.infer<typeof ImportProjectInput>;

/**
 * Cadastra o projeto em revisão (ou devolve o mesmo, se a importação se repetir). Projeto
 * que já está no Hub fora de revisão não é importado de novo.
 */
export async function importProject(
  t: TxCtx,
  raw: z.input<typeof ImportProjectInput>,
): Promise<{ project: ProjectDetail; created: boolean }> {
  authorize(t.actor, "project.import");
  const input = ImportProjectInput.parse(raw);
  assertNoSecrets({
    name: input.name,
    objective_internal: input.objective_internal,
    repo_url: input.repo_url,
    plan_path: input.plan_path,
  });
  if (
    input.start_date &&
    input.target_date &&
    input.target_date < input.start_date
  ) {
    throw badRequest("A previsão de entrega não pode ser antes do início.");
  }
  const client = await maybeOne<{ id: string; name: string }>(
    t,
    `select id, name from ${S}.clients
      where workspace_id = $1 and archived_at is null
        and (slug = $2 or lower(name) = lower($2))
      order by created_at limit 1`,
    [t.actor.workspaceId, input.client],
  );
  if (!client) {
    throw unprocessable(
      `Cliente "${input.client}" não encontrado: cadastre antes com hub_create_client.`,
    );
  }
  const existing = await maybeOne<{
    id: string;
    status: keyof typeof PROJECT_STATUS;
    client_id: string;
  }>(
    t,
    `select id, status::text as status, client_id from ${S}.projects where code = $1`,
    [input.code],
  );
  if (existing) {
    if (existing.status === "in_review" && existing.client_id === client.id) {
      return { project: await getProject(t, input.code), created: false };
    }
    throw conflict(
      `Já existe o projeto ${input.code} (${PROJECT_STATUS[existing.status]?.label ?? existing.status}). Projeto que já está no Hub não é importado de novo: escolha outro código ou peça ao Fábio.`,
      { project_status: existing.status },
    );
  }
  const slugs = [...new Set(input.departments ?? [])];
  const departments = await many<{ id: string; slug: string }>(
    t,
    `select id, slug from ${S}.departments
      where workspace_id = $1 and slug = any($2::text[])`,
    [t.actor.workspaceId, slugs],
  );
  if (departments.length !== slugs.length) {
    const known = new Set(departments.map((d) => d.slug));
    throw unprocessable(
      `Departamento desconhecido: ${slugs.filter((s) => !known.has(s)).join(", ")}. Veja os departamentos em hub_whoami.`,
    );
  }
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.projects
       (workspace_id, client_id, code, name, phase, status, objective_internal,
        start_date, target_date, repo_url, plan_path)
     values ($1, $2, $3, $4, $5, 'in_review', $6, $7, $8, $9, $10)
     returning id`,
    [
      t.actor.workspaceId,
      client.id,
      input.code,
      input.name,
      input.phase ?? "descobrir",
      input.objective_internal || null,
      input.start_date ?? null,
      input.target_date ?? null,
      input.repo_url ?? null,
      input.plan_path ?? null,
    ],
  );
  const projectId = row!.id;
  // Os status padrão do workspace (A fazer … Concluída): sem eles a tarefa não nasce.
  await t.tx.query(
    `insert into ${S}.task_statuses
       (workspace_id, project_id, name, color, category, sort_order, is_default)
     select w.id, $2, s ->> 'name', s ->> 'color', (s ->> 'category')::${S}.status_category,
            (s ->> 'sort_order')::int, (s ->> 'is_default')::boolean
       from ${S}.workspaces w, jsonb_array_elements(w.settings -> 'default_task_statuses') s
      where w.id = $1`,
    [t.actor.workspaceId, projectId],
  );
  await setDepartments(
    t,
    projectId,
    departments.map((d) => d.id),
  );
  const project = await getProject(t, input.code);
  await audit(t, {
    action: "project.created",
    entityType: "project",
    entityId: projectId,
    projectId,
    after: {
      code: project.code,
      name: project.name,
      client: project.client.name,
      phase: project.phase,
      status: project.status,
      via: "importação",
    },
  });
  return { project, created: true };
}

export const ImportProjectPlanInput = ImportPlanInput.extend({
  summary: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .describe(
      "Para o Fábio decidir: de onde veio o plano, o que ficou de fora e por quê.",
    ),
  next_status: z
    .enum(["discovery", "active", "paused"])
    .optional()
    .describe(
      "Status do projeto quando o Fábio aprovar a importação (padrão: active).",
    ),
});

export type ImportProjectPlanResult = ImportPlanResult & {
  /** O pedido import_review (null na prévia). */
  approval: { id: string; created: boolean } | null;
};

/**
 * Importa o plan.md num projeto em revisão (marcos, frentes, tarefas e os critérios do
 * GATE) e abre o pedido import_review, um só por projeto. Com dry_run, só a prévia.
 */
export async function importProjectPlan(
  t: TxCtx,
  raw: z.input<typeof ImportProjectPlanInput>,
): Promise<ImportProjectPlanResult> {
  authorize(t.actor, "project.import");
  const input = ImportProjectPlanInput.parse(raw);
  assertNoSecrets({ summary: input.summary });
  const result = await importPlan(
    t,
    {
      project: input.project,
      markdown: input.markdown,
      dry_run: input.dry_run,
    },
    { importer: true },
  );
  if (result.dry_run) return { ...result, approval: null };
  const approval = await requestImportReview(t, input.project, {
    summary: input.summary,
    next_status: input.next_status ?? "active",
    counts: {
      milestones: result.summary.milestones_created,
      workstreams: result.summary.workstreams_created,
      tasks: result.summary.created,
      completed: result.summary.completed,
      conflicts: result.conflicts.length,
    },
  });
  return { ...result, approval };
}
