import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { conflict, forbidden, notFound, unprocessable } from "@/lib/errors";
import { iso, Line, Uuid } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";

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
  leadProfileId: string | null;
  leadName: string | null;
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
    lead_profile_id: string | null;
    lead_name: string | null;
  }>(
    t,
    `select d.id, d.name, d.slug, d.lead_profile_id, p.full_name as lead_name
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
      leadProfileId: d.lead_profile_id,
      leadName: d.lead_name,
    })),
    aiBudgetUsd: Number.isFinite(budget) && budget > 0 ? budget : null,
  };
}

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
