import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { conflict, notFound, unprocessable } from "@/lib/errors";
import { resolveProject, Uuid } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Pessoas no projeto (RF-03; PRD §4.1): quem da equipe comum participa de cada projeto e
 * com que papel. Responsável (`lead`) e equipe (`member`) trabalham no projeto; convidado
 * (`guest`) só acompanha (leitura). Dono e administração já veem todos os projetos e não
 * precisam estar aqui. Mexer é do dono e da administração (workspace.admin).
 */

export const PROJECT_MEMBER_ROLES = ["lead", "member", "guest"] as const;
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];

export const PROJECT_MEMBER_ROLE_LABEL: Record<ProjectMemberRole, string> = {
  lead: "Responsável",
  member: "Equipe",
  guest: "Convidado (só acompanha)",
};

export type ProjectMemberDto = {
  profileId: string;
  name: string;
  role: ProjectMemberRole;
  /** O papel da pessoa no workspace (dono e administração já veem tudo). */
  workspaceRole: "owner" | "admin" | "member";
};

export async function listProjectMembers(
  t: TxCtx,
  code: string,
): Promise<ProjectMemberDto[]> {
  const project = await resolveProject(t, code, "workspace.admin");
  const rows = await many<{
    profile_id: string;
    name: string;
    role: ProjectMemberRole;
    workspace_role: ProjectMemberDto["workspaceRole"];
  }>(
    t,
    `select pm.profile_id, p.full_name as name, pm.role::text as role,
            m.role::text as workspace_role
       from ${S}.project_members pm
       join ${S}.profiles p on p.id = pm.profile_id
       join ${S}.memberships m on m.profile_id = pm.profile_id and m.status = 'active'
      where pm.project_id = $1 and pm.role in ('lead', 'member', 'guest')
      order by case pm.role when 'lead' then 0 when 'member' then 1 else 2 end,
               p.full_name`,
    [project.id],
  );
  return rows.map((r) => ({
    profileId: r.profile_id,
    name: r.name,
    role: r.role,
    workspaceRole: r.workspace_role,
  }));
}

export const ProjectMemberInput = z.strictObject({
  profile_id: Uuid,
  role: z.enum(PROJECT_MEMBER_ROLES),
});

/** Põe a pessoa no projeto ou muda o papel dela (só gente ativa da equipe). */
export async function setProjectMember(
  t: TxCtx,
  code: string,
  raw: z.input<typeof ProjectMemberInput>,
): Promise<void> {
  const input = ProjectMemberInput.parse(raw);
  const project = await resolveProject(t, code, "workspace.admin");
  const person = await maybeOne<{ name: string }>(
    t,
    `select p.full_name as name from ${S}.memberships m
       join ${S}.profiles p on p.id = m.profile_id
      where m.profile_id = $1 and m.status = 'active' and p.deactivated_at is null`,
    [input.profile_id],
  );
  if (!person) throw notFound("Essa pessoa não está na equipe ativa.");
  const before = await maybeOne<{ role: string }>(
    t,
    `select role::text as role from ${S}.project_members
      where project_id = $1 and profile_id = $2`,
    [project.id, input.profile_id],
  );
  if (before?.role === input.role) return;
  if (before && !PROJECT_MEMBER_ROLES.includes(before.role as never)) {
    throw conflict("Essa pessoa está no projeto como contato do cliente.");
  }
  await t.tx.query(
    `insert into ${S}.project_members (workspace_id, project_id, profile_id, role)
     values ($1, $2, $3, $4::${S}.project_role)
     on conflict (project_id, profile_id) do update set role = excluded.role`,
    [t.actor.workspaceId, project.id, input.profile_id, input.role],
  );
  await audit(t, {
    action: before ? "project.member_role_changed" : "project.member_added",
    entityType: "project",
    entityId: project.id,
    projectId: project.id,
    before: before ? { name: person.name, role: before.role } : null,
    after: { name: person.name, role: input.role },
  });
}

/** Tira a pessoa do projeto. O responsável do projeto continua: troque antes no projeto. */
export async function removeProjectMember(
  t: TxCtx,
  code: string,
  profileId: string,
): Promise<void> {
  if (!Uuid.safeParse(profileId).success)
    throw notFound("Pessoa não encontrada.");
  const project = await resolveProject(t, code, "workspace.admin");
  const owner = await maybeOne<{ owner_profile_id: string | null }>(
    t,
    `select owner_profile_id from ${S}.projects where id = $1`,
    [project.id],
  );
  if (owner?.owner_profile_id === profileId) {
    throw unprocessable(
      "Essa pessoa é a responsável pelo projeto: troque o responsável em Editar projeto antes.",
    );
  }
  const removed = await maybeOne<{ role: string; name: string }>(
    t,
    `delete from ${S}.project_members pm
      using ${S}.profiles p
      where pm.project_id = $1 and pm.profile_id = $2 and p.id = pm.profile_id
        and pm.role in ('lead', 'member', 'guest')
      returning pm.role::text as role, p.full_name as name`,
    [project.id, profileId],
  );
  if (!removed) throw notFound("Essa pessoa não está no projeto.");
  await audit(t, {
    action: "project.member_removed",
    entityType: "project",
    entityId: project.id,
    projectId: project.id,
    before: { name: removed.name, role: removed.role },
  });
}

/** O papel de quem vê no projeto (para a tela esconder o que o convidado não faz). */
export async function myProjectRole(
  t: TxCtx,
  projectId: string,
): Promise<ProjectMemberRole | null> {
  if (t.actor.type !== "user") return null;
  const row = await maybeOne<{ role: string }>(
    t,
    `select role::text as role from ${S}.project_members
      where project_id = $1 and profile_id = $2`,
    [projectId, t.actor.id],
  );
  return row && PROJECT_MEMBER_ROLES.includes(row.role as never)
    ? (row.role as ProjectMemberRole)
    : null;
}

/** A equipe comum ativa (papel Equipe no Hub), para pôr nos projetos. */
export async function teamForProjects(
  t: TxCtx,
): Promise<{ id: string; name: string }[]> {
  authorize(t.actor, "workspace.admin");
  return many<{ id: string; name: string }>(
    t,
    `select p.id, p.full_name as name
       from ${S}.memberships m
       join ${S}.profiles p on p.id = m.profile_id
      where m.status = 'active' and m.role = 'member' and p.deactivated_at is null
      order by p.full_name`,
  );
}
