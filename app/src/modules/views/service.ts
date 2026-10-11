import { audit } from "@/lib/audit";
import { can } from "@/lib/authorize";
import { badRequest, forbidden, notFound, unprocessable } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import { iso, Line, resolveProject, Uuid } from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Visões salvas por pessoa (Lista e Quadro de um projeto): um nome e os filtros do
 * endereço. Cada um vê só as próprias; agentes filtram pela API.
 */

export type ViewType = "list" | "board";

export type SavedViewDto = {
  id: string;
  name: string;
  type: ViewType;
  /** Parâmetros do endereço, já normalizados pela tela (ex.: "resp=eu&prio=urgent"). */
  query: string;
  created_at: string;
};

const MAX_VIEWS = 20;

function me(t: TxCtx): string {
  if (t.actor.type !== "user") {
    throw badRequest("Visões salvas são de pessoas.");
  }
  return t.actor.id;
}

export async function listSavedViews(
  t: TxCtx,
  projectId: string,
  type: ViewType,
): Promise<SavedViewDto[]> {
  if (t.actor.type !== "user") return [];
  const rows = await many<{
    id: string;
    name: string;
    type: ViewType;
    config: { query?: unknown };
    created_at: Date | string;
  }>(
    t,
    `select id, name, type, config, created_at from ${S}.saved_views
      where profile_id = $1 and project_id = $2 and type = $3
      order by name`,
    [t.actor.id, projectId, type],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    query: typeof r.config?.query === "string" ? r.config.query : "",
    created_at: iso(r.created_at),
  }));
}

export async function saveView(
  t: TxCtx,
  projectCode: string,
  input: { type: ViewType; name: string; query: string },
): Promise<SavedViewDto> {
  const profile = me(t);
  const project = await resolveProject(t, projectCode, "project.read");
  const name = Line(60).safeParse(input.name);
  if (!name.success) {
    throw badRequest("Dê um nome de até 60 caracteres à visão.");
  }
  if (input.query.length > 600) {
    throw unprocessable("Filtros demais para uma visão. Simplifique.");
  }
  assertNoSecrets({ name: name.data });
  const count = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.saved_views where profile_id = $1 and project_id = $2`,
    [profile, project.id],
  );
  if (count!.n >= MAX_VIEWS) {
    throw unprocessable(
      `Você já tem ${MAX_VIEWS} visões neste projeto. Apague alguma antes.`,
    );
  }
  const row = await maybeOne<{ id: string; created_at: Date | string }>(
    t,
    `insert into ${S}.saved_views (workspace_id, profile_id, project_id, type, name, config)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     returning id, created_at`,
    [
      t.actor.workspaceId,
      profile,
      project.id,
      input.type,
      name.data,
      json({ query: input.query }),
    ],
  );
  return {
    id: row!.id,
    name: name.data,
    type: input.type,
    query: input.query,
    created_at: iso(row!.created_at),
  };
}

export async function deleteView(t: TxCtx, id: string): Promise<void> {
  const profile = me(t);
  if (!Uuid.safeParse(id).success) throw badRequest("Visão inválida.");
  const row = await maybeOne<{ id: string }>(
    t,
    `delete from ${S}.saved_views where id = $1 and profile_id = $2 returning id`,
    [id, profile],
  );
  if (!row) throw notFound("Visão não encontrada.");
}

// Visão padrão de cada departamento (RF-23) --------------------------------------------

/**
 * Na Lista e no Quadro de todos os projetos, cada departamento com frente no projeto tem
 * a sua visão pronta, para toda a equipe: a que o departamento guardou (o dono, a
 * administração ou o responsável dele) ou, sem ela, só o filtro do departamento. Fica em
 * `saved_views` com o departamento e sem projeto, uma por tela.
 */

export type DepartmentViewDto = {
  slug: string;
  name: string;
  color: string;
  /** O endereço guardado pelo departamento (sempre com depto=<slug>) ou null. */
  stored: string | null;
  /** Quem vê pode mudar o padrão: dono, administração ou o responsável do departamento. */
  canEdit: boolean;
};

function canEditDepartmentView(t: TxCtx, lead: string | null): boolean {
  return (
    t.actor.type === "user" &&
    (can(t.actor, "workspace.admin") || lead === t.actor.id)
  );
}

const STORED_QUERY = `(select v.config->>'query' from ${S}.saved_views v
    where v.department_id = d.id and v.project_id is null and v.type = $2
    order by v.updated_at desc, v.id limit 1)`;

/** As visões padrão dos departamentos de um projeto, na ordem recebida. */
export async function departmentViews(
  t: TxCtx,
  departments: { id: string; slug: string; name: string; color: string }[],
  type: ViewType,
): Promise<DepartmentViewDto[]> {
  if (departments.length === 0) return [];
  const rows = await many<{
    id: string;
    lead_profile_id: string | null;
    query: string | null;
  }>(
    t,
    `select d.id, d.lead_profile_id, ${STORED_QUERY} as query
       from ${S}.departments d
      where d.id = any($1::uuid[])`,
    [departments.map((d) => d.id), type],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return departments.map((d) => ({
    slug: d.slug,
    name: d.name,
    color: d.color,
    stored: byId.get(d.id)?.query ?? null,
    canEdit: canEditDepartmentView(t, byId.get(d.id)?.lead_profile_id ?? null),
  }));
}

/** O endereço guardado de cada tela de um departamento (para os atalhos da tela dele). */
export async function storedDepartmentViews(
  t: TxCtx,
  departmentId: string,
): Promise<Record<ViewType, string | null>> {
  const rows = await many<{ type: ViewType; query: string | null }>(
    t,
    `select distinct on (v.type) v.type, v.config->>'query' as query
       from ${S}.saved_views v
      where v.department_id = $1 and v.project_id is null
        and v.type in ('list', 'board')
      order by v.type, v.updated_at desc, v.id`,
    [departmentId],
  );
  return {
    list: rows.find((r) => r.type === "list")?.query ?? null,
    board: rows.find((r) => r.type === "board")?.query ?? null,
  };
}

/** O departamento, travado, se quem pede pode mudar a visão padrão dele. */
async function departmentToEdit(
  t: TxCtx,
  slug: string,
): Promise<{ id: string; slug: string; name: string }> {
  me(t);
  const department = await maybeOne<{
    id: string;
    slug: string;
    name: string;
    lead_profile_id: string | null;
  }>(
    t,
    `select id, slug, name, lead_profile_id from ${S}.departments
      where slug = $1 for update`,
    [slug],
  );
  if (!department) throw notFound("Departamento não encontrado.");
  if (!canEditDepartmentView(t, department.lead_profile_id)) {
    throw forbidden(
      "Só o dono, a administração ou o responsável do departamento mudam a visão padrão dele.",
    );
  }
  return department;
}

/**
 * Guarda a visão padrão do departamento numa tela (troca a anterior). O endereço já vem
 * normalizado pela tela; precisa do filtro do departamento e não leva frente, que é de
 * um projeto só.
 */
export async function setDepartmentView(
  t: TxCtx,
  input: { department: string; type: ViewType; query: string },
): Promise<void> {
  const department = await departmentToEdit(t, input.department);
  if (input.query.length > 600) {
    throw unprocessable("Filtros demais para uma visão. Simplifique.");
  }
  const params = new URLSearchParams(input.query);
  if (params.get("depto") !== department.slug || params.has("frente")) {
    throw badRequest(
      "A visão padrão do departamento leva o filtro dele e nenhuma frente.",
    );
  }
  await t.tx.query(
    `delete from ${S}.saved_views
      where department_id = $1 and project_id is null and type = $2`,
    [department.id, input.type],
  );
  await t.tx.query(
    `insert into ${S}.saved_views
       (workspace_id, profile_id, department_id, type, name, config)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      t.actor.workspaceId,
      t.actor.id,
      department.id,
      input.type,
      `Padrão de ${department.name}`,
      json({ query: input.query }),
    ],
  );
  await audit(t, {
    action: "department.view_set",
    entityType: "department",
    entityId: department.id,
    after: { type: input.type, query: input.query },
  });
}

/** Volta a visão padrão do departamento numa tela para o padrão do Hub (só o filtro). */
export async function resetDepartmentView(
  t: TxCtx,
  input: { department: string; type: ViewType },
): Promise<void> {
  const department = await departmentToEdit(t, input.department);
  const removed = await many<{ id: string }>(
    t,
    `delete from ${S}.saved_views
      where department_id = $1 and project_id is null and type = $2
      returning id`,
    [department.id, input.type],
  );
  if (removed.length === 0) return;
  await audit(t, {
    action: "department.view_reset",
    entityType: "department",
    entityId: department.id,
    after: { type: input.type },
  });
}
