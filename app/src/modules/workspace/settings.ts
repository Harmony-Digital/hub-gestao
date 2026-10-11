import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { conflict, forbidden, notFound, unprocessable } from "@/lib/errors";
import { iso, Line, Uuid } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { slugify } from "@/modules/projects/admin";

/**
 * Configurações do workspace (M3, PRD §11): o nome, a equipe e os responsáveis dos
 * departamentos, com atalhos para o que já tem tela própria (modelos, agentes, chaves).
 * Ver é do dono e da administração. Mudar a equipe é só do dono; o responsável de um
 * departamento, dono e administração. Agente nunca: `workspace.admin` é de pessoa, e o
 * banco recusa agente escrevendo em perfil ou vínculo.
 */

export type TeamMember = {
  profileId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "active" | "suspended";
  /** Já entrou no Hub alguma vez (o login está ligado ao perfil). */
  linked: boolean;
  lastActivity: string | null;
  me: boolean;
};

export type DepartmentSetting = {
  id: string;
  name: string;
  slug: string;
  color: string;
  leadProfileId: string | null;
  leadName: string | null;
  /** Onde o departamento está em uso (só dá para remover quando nada usa). */
  usage: { projects: number; workstreams: number; agents: number };
};

export type WorkspaceSettings = {
  workspace: {
    name: string;
    slug: string;
    timezone: string;
    taskPrefix: string;
  };
  team: TeamMember[];
  departments: DepartmentSetting[];
  /** Teto de IA do mês (LLM_MONTHLY_BUDGET_USD), se definido no servidor. */
  aiBudgetUsd: number | null;
};

function assertOwner(t: TxCtx) {
  authorize(t.actor, "workspace.admin");
  if (
    t.actor.type !== "user" ||
    t.actor.scope !== "internal" ||
    t.actor.role !== "owner"
  ) {
    throw forbidden("Só o dono do workspace muda a equipe e o nome.");
  }
}

export async function workspaceSettings(t: TxCtx): Promise<WorkspaceSettings> {
  authorize(t.actor, "workspace.admin");
  const ws = await maybeOne<{
    name: string;
    slug: string;
    timezone: string;
    task_prefix: string;
  }>(
    t,
    `select name, slug, timezone, task_prefix from ${S}.workspaces where id = $1`,
    [t.actor.workspaceId],
  );
  if (!ws) throw notFound("Workspace não encontrado.");
  const team = await many<{
    profile_id: string;
    full_name: string;
    email: string;
    role: TeamMember["role"];
    status: TeamMember["status"];
    linked: boolean;
    last_activity: Date | string | null;
  }>(
    t,
    `select p.id as profile_id, p.full_name, p.email, m.role::text as role, m.status,
            p.auth_user_id is not null as linked,
            (select max(a.created_at) from ${S}.activity_log a
              where a.actor_type = 'user' and a.actor_id = p.id) as last_activity
       from ${S}.memberships m
       join ${S}.profiles p on p.id = m.profile_id
      order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
               p.full_name`,
  );
  const departments = await many<{
    id: string;
    name: string;
    slug: string;
    color: string;
    lead_profile_id: string | null;
    lead_name: string | null;
    projects: number;
    workstreams: number;
    agents: number;
  }>(
    t,
    `select d.id, d.name, d.slug, d.color, d.lead_profile_id, p.full_name as lead_name,
            ${DEPARTMENT_USAGE_SQL}
       from ${S}.departments d
       left join ${S}.profiles p on p.id = d.lead_profile_id
      order by d.sort_order, d.name`,
  );
  const budget = Number(process.env.LLM_MONTHLY_BUDGET_USD);
  return {
    workspace: {
      name: ws.name,
      slug: ws.slug,
      timezone: ws.timezone,
      taskPrefix: ws.task_prefix,
    },
    team: team.map((m) => ({
      profileId: m.profile_id,
      name: m.full_name,
      email: m.email,
      role: m.role,
      status: m.status,
      linked: m.linked,
      lastActivity: m.last_activity ? iso(m.last_activity) : null,
      me: t.actor.type === "user" && m.profile_id === t.actor.id,
    })),
    departments: departments.map((d) => ({
      id: d.id,
      name: d.name,
      slug: d.slug,
      color: d.color,
      leadProfileId: d.lead_profile_id,
      leadName: d.lead_name,
      usage: {
        projects: d.projects,
        workstreams: d.workstreams,
        agents: d.agents,
      },
    })),
    aiBudgetUsd: Number.isFinite(budget) && budget > 0 ? budget : null,
  };
}

/** Onde cada departamento (d) está em uso: projetos, frentes (até arquivadas) e agentes. */
const DEPARTMENT_USAGE_SQL = `
  (select count(*)::int from ${S}.project_departments pd where pd.department_id = d.id) as projects,
  (select count(*)::int from ${S}.workstreams w where w.department_id = d.id) as workstreams,
  (select count(*)::int from ${S}.agents a
    where a.department_id = d.id and a.status <> 'revoked') as agents`;

export const WorkspaceNameInput = z.strictObject({ name: Line(120) });

export async function renameWorkspace(
  t: TxCtx,
  input: z.infer<typeof WorkspaceNameInput>,
): Promise<void> {
  assertOwner(t);
  const before = await maybeOne<{ name: string }>(
    t,
    `select name from ${S}.workspaces where id = $1`,
    [t.actor.workspaceId],
  );
  if (!before || before.name === input.name) return;
  await t.tx.query(`update ${S}.workspaces set name = $2 where id = $1`, [
    t.actor.workspaceId,
    input.name,
  ]);
  await audit(t, {
    action: "workspace.renamed",
    entityType: "workspace",
    entityId: t.actor.workspaceId,
    before: { name: before.name },
    after: { name: input.name },
  });
}

export const MemberInput = z.strictObject({
  name: Line(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "E-mail inválido."),
  role: z.enum(["member", "admin"]),
});
export type MemberInput = z.infer<typeof MemberInput>;

/**
 * Põe uma pessoa na equipe: o perfil (ou o que já existe com o mesmo e-mail) e o vínculo.
 * Ela entra no Hub com esse e-mail, pelo login do Supabase (o Fábio cria o usuário no
 * Studio) ou pelo link de acesso por e-mail, quando ligado.
 */
export async function addMember(
  t: TxCtx,
  input: MemberInput,
): Promise<{ profileId: string }> {
  assertOwner(t);
  const existing = await maybeOne<{ id: string; contact: boolean }>(
    t,
    `select p.id,
            exists (select 1 from ${S}.client_contacts c where c.profile_id = p.id) as contact
       from ${S}.profiles p
      where lower(p.email) = lower($1) and p.deactivated_at is null`,
    [input.email],
  );
  if (existing?.contact) {
    throw unprocessable(
      "Esse e-mail é de um contato de cliente no portal. Use outro e-mail para a pessoa da equipe.",
    );
  }
  if (existing) {
    const member = await maybeOne(
      t,
      `select 1 from ${S}.memberships where profile_id = $1`,
      [existing.id],
    );
    if (member) throw conflict("Essa pessoa já está na equipe.");
  }
  // O id é gerado aqui: o perfil novo só fica visível (RLS) depois de ligado à equipe.
  const profileId = existing?.id ?? randomUUID();
  if (!existing) {
    await t.tx.query(
      `insert into ${S}.profiles (id, email, full_name) values ($1, $2, $3)`,
      [profileId, input.email, input.name],
    );
  }
  await t.tx.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role, status)
     values ($1, $2, $3, 'active')`,
    [t.actor.workspaceId, profileId, input.role],
  );
  await audit(t, {
    action: "member.added",
    entityType: "profile",
    entityId: profileId,
    after: { name: input.name, role: input.role },
  });
  return { profileId };
}

async function lockMember(t: TxCtx, profileId: string) {
  if (!Uuid.safeParse(profileId).success) {
    throw notFound("Pessoa não encontrada na equipe.");
  }
  const row = await maybeOne<{
    role: TeamMember["role"];
    status: TeamMember["status"];
    full_name: string;
  }>(
    t,
    `select m.role::text as role, m.status, p.full_name
       from ${S}.memberships m
       join ${S}.profiles p on p.id = m.profile_id
      where m.profile_id = $1 and m.workspace_id = $2
      for update of m`,
    [profileId, t.actor.workspaceId],
  );
  if (!row) throw notFound("Pessoa não encontrada na equipe.");
  if (t.actor.type === "user" && t.actor.id === profileId) {
    throw unprocessable("Você não muda o próprio papel nem o próprio acesso.");
  }
  if (row.role === "owner") {
    throw unprocessable("O dono do workspace não muda por aqui.");
  }
  return row;
}

export async function setMemberRole(
  t: TxCtx,
  profileId: string,
  role: "member" | "admin",
): Promise<void> {
  assertOwner(t);
  const current = await lockMember(t, profileId);
  if (current.role === role) return;
  await t.tx.query(
    `update ${S}.memberships set role = $3
      where profile_id = $1 and workspace_id = $2`,
    [profileId, t.actor.workspaceId, role],
  );
  await audit(t, {
    action: "member.role_changed",
    entityType: "profile",
    entityId: profileId,
    before: { role: current.role },
    after: { role },
  });
}

/** Suspender tira o acesso na hora (o login confere o vínculo a cada tela); reativar devolve. */
export async function setMemberStatus(
  t: TxCtx,
  profileId: string,
  status: "active" | "suspended",
): Promise<void> {
  assertOwner(t);
  const current = await lockMember(t, profileId);
  if (current.status === status) return;
  await t.tx.query(
    `update ${S}.memberships set status = $3
      where profile_id = $1 and workspace_id = $2`,
    [profileId, t.actor.workspaceId, status],
  );
  await audit(t, {
    action: status === "suspended" ? "member.suspended" : "member.reactivated",
    entityType: "profile",
    entityId: profileId,
    before: { status: current.status },
    after: { status },
  });
}

/** Responsável do departamento: alguém ativo da equipe, ou ninguém. Dono e administração. */
export async function setDepartmentLead(
  t: TxCtx,
  departmentId: string,
  profileId: string | null,
): Promise<void> {
  authorize(t.actor, "workspace.admin");
  if (!Uuid.safeParse(departmentId).success) {
    throw notFound("Departamento não encontrado.");
  }
  const department = await maybeOne<{ lead_profile_id: string | null }>(
    t,
    `select lead_profile_id from ${S}.departments where id = $1 for update`,
    [departmentId],
  );
  if (!department) throw notFound("Departamento não encontrado.");
  // Sem mudança, nada a conferir (o responsável atual pode ter saído da equipe).
  if (department.lead_profile_id === profileId) return;
  if (profileId !== null) {
    if (!Uuid.safeParse(profileId).success) {
      throw unprocessable("Escolha alguém da equipe.");
    }
    const active = await maybeOne(
      t,
      `select 1 from ${S}.memberships
        where profile_id = $1 and workspace_id = $2 and status = 'active'`,
      [profileId, t.actor.workspaceId],
    );
    if (!active) throw unprocessable("Escolha alguém ativo da equipe.");
  }
  await t.tx.query(
    `update ${S}.departments set lead_profile_id = $2 where id = $1`,
    [departmentId, profileId],
  );
  await audit(t, {
    action: "department.lead_changed",
    entityType: "department",
    entityId: departmentId,
    before: { lead_profile_id: department.lead_profile_id },
    after: { lead_profile_id: profileId },
  });
}

/** Para o e-mail de teste: o próprio dono (nunca outra pessoa) e o nome do workspace. */
export async function emailTestTarget(
  t: TxCtx,
): Promise<{ email: string; name: string; orgName: string }> {
  assertOwner(t);
  const row = await maybeOne<{ email: string; full_name: string; org: string }>(
    t,
    `select p.email, p.full_name, w.name as org
       from ${S}.profiles p, ${S}.workspaces w
      where p.id = $1 and w.id = $2`,
    [t.actor.type === "user" ? t.actor.id : null, t.actor.workspaceId],
  );
  if (!row) throw notFound("Perfil não encontrado.");
  return { email: row.email, name: row.full_name, orgName: row.org };
}

// Departamentos (RF-27) -------------------------------------------------------------------

export const DepartmentInput = z.strictObject({
  name: Line(80),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Use a cor no formato #RRGGBB."),
});
export type DepartmentInput = z.infer<typeof DepartmentInput>;

async function assertFreeDepartmentName(
  t: TxCtx,
  name: string,
  exceptId: string | null,
): Promise<void> {
  const taken = await maybeOne(
    t,
    `select 1 from ${S}.departments
      where lower(name) = lower($1) and ($2::uuid is null or id <> $2)`,
    [name, exceptId],
  );
  if (taken) throw conflict(`Já existe um departamento chamado “${name}”.`);
}

/**
 * Departamento novo (dono e administração), no fim da lista. O endereço (slug) sai do
 * nome e não muda depois: renomear não quebra os links nem os modelos de projeto.
 */
export async function createDepartment(
  t: TxCtx,
  input: DepartmentInput,
): Promise<{ id: string; slug: string }> {
  authorize(t.actor, "workspace.admin");
  const { name, color } = DepartmentInput.parse(input);
  await assertFreeDepartmentName(t, name, null);
  const base = slugify(name).slice(0, 50).replace(/-+$/g, "") || "departamento";
  const used = new Set(
    (
      await many<{ slug: string }>(
        t,
        `select slug from ${S}.departments where slug = $1 or slug like $1 || '-%'`,
        [base],
      )
    ).map((r) => r.slug),
  );
  let slug = base;
  for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.departments (workspace_id, slug, name, color, sort_order)
     values ($1, $2, $3, $4,
             coalesce((select max(sort_order) + 1 from ${S}.departments), 0))
     returning id`,
    [t.actor.workspaceId, slug, name, color.toUpperCase()],
  );
  await audit(t, {
    action: "department.created",
    entityType: "department",
    entityId: row!.id,
    after: { name, slug, color: color.toUpperCase() },
  });
  return { id: row!.id, slug };
}

/** Novo nome ou nova cor (dono e administração). O endereço continua o mesmo. */
export async function updateDepartment(
  t: TxCtx,
  departmentId: string,
  input: DepartmentInput,
): Promise<void> {
  authorize(t.actor, "workspace.admin");
  if (!Uuid.safeParse(departmentId).success) {
    throw notFound("Departamento não encontrado.");
  }
  const { name, color } = DepartmentInput.parse(input);
  const before = await maybeOne<{ name: string; color: string }>(
    t,
    `select name, color from ${S}.departments where id = $1 for update`,
    [departmentId],
  );
  if (!before) throw notFound("Departamento não encontrado.");
  const next = { name, color: color.toUpperCase() };
  if (before.name === next.name && before.color.toUpperCase() === next.color) {
    return;
  }
  if (before.name.toLowerCase() !== name.toLowerCase()) {
    await assertFreeDepartmentName(t, name, departmentId);
  }
  await t.tx.query(
    `update ${S}.departments set name = $2, color = $3 where id = $1`,
    [departmentId, next.name, next.color],
  );
  await audit(t, {
    action: "department.updated",
    entityType: "department",
    entityId: departmentId,
    before,
    after: next,
  });
}

/**
 * Remove o departamento (dono e administração), só quando nada o usa: projeto, frente
 * (mesmo arquivada) ou agente. Senão, diz onde ele está, para tirar antes.
 */
export async function removeDepartment(
  t: TxCtx,
  departmentId: string,
): Promise<void> {
  authorize(t.actor, "workspace.admin");
  if (!Uuid.safeParse(departmentId).success) {
    throw notFound("Departamento não encontrado.");
  }
  const d = await maybeOne<{
    name: string;
    slug: string;
    projects: number;
    workstreams: number;
    agents: number;
  }>(
    t,
    `select d.name, d.slug, ${DEPARTMENT_USAGE_SQL}
       from ${S}.departments d where d.id = $1 for update`,
    [departmentId],
  );
  if (!d) throw notFound("Departamento não encontrado.");
  const uses = [
    [d.projects, "projeto", "projetos"],
    [d.workstreams, "frente", "frentes"],
    [d.agents, "agente", "agentes"],
  ] as const;
  const inUse = uses
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  if (inUse.length > 0) {
    throw unprocessable(
      `${d.name} está em uso (${inUse.join(", ")}). Troque o departamento deles antes de remover.`,
    );
  }
  await t.tx.query(`delete from ${S}.departments where id = $1`, [
    departmentId,
  ]);
  await audit(t, {
    action: "department.removed",
    entityType: "department",
    entityId: departmentId,
    before: { name: d.name, slug: d.slug },
  });
}
