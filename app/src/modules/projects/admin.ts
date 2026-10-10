import { z } from "zod";
import { authorize } from "@/lib/authorize";
import { audit, changedFields } from "@/lib/audit";
import {
  badRequest,
  conflict,
  notFound,
  preconditionFailed,
  unprocessable,
} from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import {
  iso,
  IsoDate,
  Line,
  ProjectCode,
  resolveProject,
  Uuid,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { ProjectPhase, type ProjectDetail } from "./schemas";
import { getProject } from "./service";

/**
 * Cadastro de clientes e projetos pela interface (M3). Só pessoas com papel de
 * administração do workspace (owner ou admin): agentes importam projetos pelo caminho
 * próprio do M5, com revisão do Fábio (D10).
 */

const ADMIN = "workspace.admin" as const;

// Clientes ----------------------------------------------------------------------------

export const ClientInput = z.strictObject({
  name: Line(160),
  segment: Line(120).nullable().optional(),
  notes_internal: z.string().trim().max(4000).nullable().optional(),
});
export type ClientInput = z.infer<typeof ClientInput>;

export type ClientDto = {
  id: string;
  slug: string;
  name: string;
  segment: string | null;
  notes_internal: string | null;
  project_count: number;
  updated_at: string;
};

type ClientRow = Omit<ClientDto, "updated_at"> & { updated_at: Date | string };

const CLIENT_SELECT = `
  select c.id, c.slug, c.name, c.segment, c.notes_internal, c.updated_at,
         (select count(*)::int from ${S}.projects p
           where p.client_id = c.id and p.archived_at is null) as project_count
    from ${S}.clients c`;

const toClient = (r: ClientRow): ClientDto => ({
  ...r,
  updated_at: iso(r.updated_at),
});

/** "Clínica São José!" → "clinica-sao-jose". Vazio vira "cliente". */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "cliente";
}

export async function listClients(t: TxCtx): Promise<ClientDto[]> {
  authorize(t.actor, "project.read");
  const rows = await many<ClientRow>(
    t,
    `${CLIENT_SELECT} where c.archived_at is null order by c.name`,
  );
  return rows.map(toClient);
}

async function clientById(t: TxCtx, id: string): Promise<ClientDto> {
  const row = await maybeOne<ClientRow>(t, `${CLIENT_SELECT} where c.id = $1`, [
    id,
  ]);
  if (!row) throw notFound("Cliente não encontrado neste workspace.");
  return toClient(row);
}

async function freeSlug(t: TxCtx, base: string): Promise<string> {
  const taken = new Set(
    (
      await many<{ slug: string }>(
        t,
        `select slug from ${S}.clients where slug = $1 or slug like $1 || '-%'`,
        [base],
      )
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

export async function createClient(
  t: TxCtx,
  input: ClientInput,
): Promise<ClientDto> {
  authorize(t.actor, ADMIN);
  assertNoSecrets({ name: input.name, notes_internal: input.notes_internal });
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
  const dto = await clientById(t, row!.id);
  await audit(t, {
    action: "client.created",
    entityType: "client",
    entityId: dto.id,
    after: { name: dto.name, slug: dto.slug, segment: dto.segment },
  });
  return dto;
}

export async function updateClient(
  t: TxCtx,
  id: string,
  input: ClientInput,
): Promise<ClientDto> {
  authorize(t.actor, ADMIN);
  if (!Uuid.safeParse(id).success) throw badRequest("Cliente inválido.");
  assertNoSecrets({ name: input.name, notes_internal: input.notes_internal });
  const before = await clientById(t, id);
  await t.tx.query(
    `update ${S}.clients set name = $2, segment = $3, notes_internal = $4 where id = $1`,
    [id, input.name, input.segment ?? null, input.notes_internal || null],
  );
  const after = await clientById(t, id);
  await audit(t, {
    action: "client.updated",
    entityType: "client",
    entityId: id,
    ...changedFields(before, after, ["name", "segment", "notes_internal"]),
  });
  return after;
}

// Projetos ----------------------------------------------------------------------------

/** Status que a tela escolhe. "Em revisão" e "Arquivado" seguem caminhos próprios. */
export const EditableProjectStatus = z.enum([
  "discovery",
  "active",
  "paused",
  "delivered",
]);

const Url = z
  .string()
  .trim()
  .max(500)
  .regex(/^https:\/\/\S+$/, "Use um endereço que comece com https://.");

const ProjectFields = {
  name: Line(160),
  client_id: Uuid,
  phase: ProjectPhase,
  status: EditableProjectStatus,
  objective_internal: z.string().trim().max(4000).nullable(),
  objective_client: z.string().trim().max(2000).nullable(),
  start_date: IsoDate.nullable(),
  target_date: IsoDate.nullable(),
  owner_profile_id: Uuid.nullable(),
  pm_agent_id: Uuid.nullable(),
  repo_url: Url.nullable(),
  plan_path: Line(300).nullable(),
  require_evidence: z.boolean(),
  client_can_confirm_receipt: z.boolean(),
  departments: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)).max(20),
};

export const CreateProjectInput = z.strictObject({
  code: ProjectCode,
  ...ProjectFields,
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const UpdateProjectInput = z.strictObject(ProjectFields);
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;

/** Pessoas, agentes, clientes e departamentos que o formulário de projeto oferece. */
export type ProjectFormOptions = {
  clients: { id: string; name: string }[];
  people: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  departments: { slug: string; name: string; color: string }[];
};

export async function projectFormOptions(
  t: TxCtx,
): Promise<ProjectFormOptions> {
  authorize(t.actor, ADMIN);
  return {
    clients: await many(
      t,
      `select id, name from ${S}.clients where archived_at is null order by name`,
    ),
    people: await many(
      t,
      `select pr.id, pr.full_name as name
         from ${S}.memberships m join ${S}.profiles pr on pr.id = m.profile_id
        where m.workspace_id = $1 and m.status = 'active' and pr.deactivated_at is null
        order by pr.full_name`,
      [t.actor.workspaceId],
    ),
    agents: await many(
      t,
      `select id, name from ${S}.agents
        where workspace_id = $1 and status <> 'revoked' order by name`,
      [t.actor.workspaceId],
    ),
    departments: await many(
      t,
      `select slug, name, color from ${S}.departments
        where workspace_id = $1 order by sort_order, name`,
      [t.actor.workspaceId],
    ),
  };
}

async function checkReferences(
  t: TxCtx,
  input: UpdateProjectInput,
): Promise<string[]> {
  if (
    input.start_date &&
    input.target_date &&
    input.target_date < input.start_date
  ) {
    throw badRequest("A previsão de entrega não pode ser antes do início.");
  }
  assertNoSecrets({
    name: input.name,
    objective_internal: input.objective_internal,
    objective_client: input.objective_client,
    repo_url: input.repo_url,
    plan_path: input.plan_path,
  });
  const client = await maybeOne(
    t,
    `select 1 from ${S}.clients where id = $1 and archived_at is null`,
    [input.client_id],
  );
  if (!client) throw unprocessable("Escolha um cliente cadastrado.");
  if (input.owner_profile_id) {
    const member = await maybeOne(
      t,
      `select 1 from ${S}.memberships where profile_id = $1 and status = 'active'`,
      [input.owner_profile_id],
    );
    if (!member) {
      throw unprocessable(
        "O responsável precisa ser uma pessoa ativa do workspace.",
      );
    }
  }
  if (input.pm_agent_id) {
    const agent = await maybeOne(
      t,
      `select 1 from ${S}.agents where id = $1 and status <> 'revoked'`,
      [input.pm_agent_id],
    );
    if (!agent)
      throw unprocessable("O agente gestor não existe ou foi revogado.");
  }
  const slugs = [...new Set(input.departments)];
  const departments = await many<{ id: string; slug: string }>(
    t,
    `select id, slug from ${S}.departments
      where workspace_id = $1 and slug = any($2::text[])`,
    [t.actor.workspaceId, slugs],
  );
  if (departments.length !== slugs.length) {
    throw unprocessable(
      "Algum departamento escolhido não existe mais. Recarregue a página.",
    );
  }
  return departments.map((d) => d.id);
}

async function setDepartments(
  t: TxCtx,
  projectId: string,
  departmentIds: string[],
): Promise<void> {
  await t.tx.query(
    `delete from ${S}.project_departments
      where project_id = $1 and not (department_id = any($2::uuid[]))`,
    [projectId, departmentIds],
  );
  await t.tx.query(
    `insert into ${S}.project_departments (workspace_id, project_id, department_id)
     select $1, $2, unnest($3::uuid[])
     on conflict do nothing`,
    [t.actor.workspaceId, projectId, departmentIds],
  );
}

async function addLead(t: TxCtx, projectId: string, profileId: string) {
  await t.tx.query(
    `insert into ${S}.project_members (workspace_id, project_id, profile_id, role)
     values ($1, $2, $3, 'lead') on conflict do nothing`,
    [t.actor.workspaceId, projectId, profileId],
  );
}

const PROJECT_AUDIT_KEYS = [
  "name",
  "client_id",
  "phase",
  "status",
  "objective_internal",
  "objective_client",
  "start_date",
  "target_date",
  "owner_profile_id",
  "pm_agent_id",
  "repo_url",
  "plan_path",
  "require_evidence",
  "client_can_confirm_receipt",
  "departments",
] as const;

export async function createProject(
  t: TxCtx,
  input: CreateProjectInput,
): Promise<ProjectDetail> {
  authorize(t.actor, ADMIN);
  const taken = await maybeOne(
    t,
    `select 1 from ${S}.projects where code = $1`,
    [input.code],
  );
  if (taken) throw conflict("Já existe um projeto com esse código.");
  const departmentIds = await checkReferences(t, input);
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.projects
       (workspace_id, client_id, code, name, phase, status, objective_internal,
        objective_client, start_date, target_date, owner_profile_id, pm_agent_id,
        repo_url, plan_path, require_evidence, client_can_confirm_receipt)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     returning id`,
    [
      t.actor.workspaceId,
      input.client_id,
      input.code,
      input.name,
      input.phase,
      input.status,
      input.objective_internal || null,
      input.objective_client || null,
      input.start_date,
      input.target_date,
      input.owner_profile_id,
      input.pm_agent_id,
      input.repo_url,
      input.plan_path,
      input.require_evidence,
      input.client_can_confirm_receipt,
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
  await setDepartments(t, projectId, departmentIds);
  if (t.actor.type === "user" && t.actor.id) {
    await addLead(t, projectId, t.actor.id);
  }
  if (input.owner_profile_id)
    await addLead(t, projectId, input.owner_profile_id);

  const dto = await getProject(t, input.code);
  await audit(t, {
    action: "project.created",
    entityType: "project",
    entityId: projectId,
    projectId,
    after: {
      code: dto.code,
      name: dto.name,
      client: dto.client.name,
      phase: dto.phase,
      status: dto.status,
    },
  });
  return dto;
}

/** Leitura plana para comparar antes e depois (o que o formulário edita). */
async function editable(t: TxCtx, id: string) {
  const row = await maybeOne<Record<string, unknown>>(
    t,
    `select p.name, p.client_id, p.phase::text as phase, p.status::text as status,
            p.objective_internal, p.objective_client, p.start_date, p.target_date,
            p.owner_profile_id, p.pm_agent_id, p.repo_url, p.plan_path,
            p.require_evidence, p.client_can_confirm_receipt, p.updated_at,
            coalesce((select array_agg(d.slug order by d.slug)
                        from ${S}.project_departments pd
                        join ${S}.departments d on d.id = pd.department_id
                       where pd.project_id = p.id), '{}') as departments
       from ${S}.projects p where p.id = $1`,
    [id],
  );
  if (!row) throw notFound("Projeto não encontrado neste workspace.");
  return row;
}

/**
 * Edita o projeto. `expectedUpdatedAt` é o `updated_at` lido pela tela: se o projeto
 * mudou no meio, nada é gravado (412) e a tela mostra a versão nova.
 */
export async function updateProject(
  t: TxCtx,
  code: string,
  input: UpdateProjectInput,
  expectedUpdatedAt?: string,
): Promise<ProjectDetail> {
  const ref = await resolveProject(t, code, ADMIN);
  await t.tx.query(`select 1 from ${S}.projects where id = $1 for update`, [
    ref.id,
  ]);
  const before = await editable(t, ref.id);
  if (expectedUpdatedAt && iso(before.updated_at) !== expectedUpdatedAt) {
    throw preconditionFailed(
      `O projeto ${ref.code} mudou desde a sua leitura. Leia de novo e refaça a alteração.`,
    );
  }
  // Projeto arquivado já parou em resolveProject (só leitura até ser restaurado).
  if (ref.status === "in_review") {
    throw unprocessable(
      "Projeto em revisão: o status muda pela decisão da importação, nas Aprovações.",
    );
  }
  const departmentIds = await checkReferences(t, input);
  const next = {
    ...input,
    objective_internal: input.objective_internal || null,
    objective_client: input.objective_client || null,
    departments: [...new Set(input.departments)].sort(),
  };
  const changes = changedFields(before, next, PROJECT_AUDIT_KEYS);
  // Nada mudou: não grava (assim a data de atualização e o histórico ficam limpos).
  if (Object.keys(changes.after).length === 0) return getProject(t, ref.code);
  await t.tx.query(
    `update ${S}.projects
        set name = $2, client_id = $3, phase = $4, status = $5, objective_internal = $6,
            objective_client = $7, start_date = $8, target_date = $9, owner_profile_id = $10,
            pm_agent_id = $11, repo_url = $12, plan_path = $13, require_evidence = $14,
            client_can_confirm_receipt = $15
      where id = $1`,
    [
      ref.id,
      input.name,
      input.client_id,
      input.phase,
      input.status,
      input.objective_internal || null,
      input.objective_client || null,
      input.start_date,
      input.target_date,
      input.owner_profile_id,
      input.pm_agent_id,
      input.repo_url,
      input.plan_path,
      input.require_evidence,
      input.client_can_confirm_receipt,
    ],
  );
  await setDepartments(t, ref.id, departmentIds);
  if (input.owner_profile_id) await addLead(t, ref.id, input.owner_profile_id);
  await audit(t, {
    action: "project.updated",
    entityType: "project",
    entityId: ref.id,
    projectId: ref.id,
    ...changes,
  });
  return getProject(t, ref.code);
}

/** Departamentos do workspace, para os formulários (frente, projeto). */
export async function departmentOptions(
  t: TxCtx,
): Promise<ProjectFormOptions["departments"]> {
  authorize(t.actor, "project.read");
  return many(
    t,
    `select slug, name, color from ${S}.departments
      where workspace_id = $1 order by sort_order, name`,
    [t.actor.workspaceId],
  );
}
