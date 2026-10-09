import { z } from "zod";
import type { Actor } from "@/lib/db/actor";
import { authorize, type Action, type ProjectRole } from "@/lib/authorize";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import { maybeOne, S, type TxCtx } from "@/modules/context";

// Mensagens de validação em português do Brasil, para API, MCP e testes (PRD §8.1).
z.config(z.locales.ptBR());

// Esquemas compartilhados por API, MCP e OpenAPI ---------------------------------------

export const ProjectCode = z
  .string()
  .regex(
    /^[A-Z0-9]{2,8}$/,
    "Código de projeto: de 2 a 8 letras maiúsculas ou números, como HUB.",
  );
export const TaskCode = z
  .string()
  .regex(/^[A-Z]{2,6}-[0-9]{1,9}$/, "Código de tarefa no formato HUB-123.");
export const MilestoneCode = z
  .string()
  .regex(/^M[0-9]{1,3}$/, "Código de marco no formato M1.");
export const Uuid = z.uuid();
export const IsoDate = z.iso.date();
export const Timestamp = z.string();
export const RoleCode = z
  .string()
  .regex(
    /^[A-Z]{2}-[0-9]{2}$/,
    "Papel no formato do catálogo AGENTES.md, como GP-01.",
  );
export const Priority = z.enum(["urgent", "high", "normal", "low"]);
export const StatusCategory = z.enum([
  "todo",
  "in_progress",
  "review",
  "blocked",
  "done",
]);
export const Visibility = z.enum(["internal", "client"]);
export const ActorType = z.enum(["user", "agent", "system"]);

export const ActorRef = z.object({
  type: ActorType,
  id: Uuid.nullable(),
  name: z.string().nullable(),
});
export type ActorRef = z.infer<typeof ActorRef>;

/** Texto livre curto, sem espaços nas pontas. */
export const Text = (max: number) => z.string().trim().min(1).max(max);

// Conversões -----------------------------------------------------------------------

export function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

export function actorRef(
  type: unknown,
  id: unknown,
  name: unknown,
): ActorRef | null {
  if (type === null || type === undefined) return null;
  return {
    type: type as ActorRef["type"],
    id: (id as string | null) ?? null,
    name: (name as string | null) ?? null,
  };
}

/** Nome de quem é referenciado por (tipo, id): pessoa ou agente. */
export const ACTOR_NAME_SQL = (typeCol: string, idCol: string) =>
  `(case ${typeCol}
      when 'user' then (select pr.full_name from ${S}.profiles pr where pr.id = ${idCol})
      when 'agent' then (select ag.name from ${S}.agents ag where ag.id = ${idCol})
      when 'system' then 'Hub'
    end)`;

// Escopo de projetos por ator ----------------------------------------------------------

/**
 * Condição SQL que limita os projetos visíveis numa listagem. Agente: os da chave.
 * Member: os de que participa. Owner, admin e sistema: todos do workspace (a RLS já
 * isola o workspace). Acrescenta os parâmetros necessários em `params`.
 */
export function projectScopeSql(
  actor: Actor,
  column: string,
  params: unknown[],
): string {
  if (actor.type === "agent" && actor.projectIds !== null) {
    params.push(actor.projectIds);
    return `${column} = any($${params.length}::uuid[])`;
  }
  if (
    actor.type === "user" &&
    actor.scope === "internal" &&
    actor.role === "member"
  ) {
    params.push(actor.id);
    return `exists (select 1 from ${S}.project_members pm
                     where pm.project_id = ${column} and pm.profile_id = $${params.length})`;
  }
  return "true";
}

export type ProjectRef = {
  id: string;
  code: string;
  name: string;
  status: string;
  require_evidence: boolean;
  workspace_id: string;
};

/** Acha o projeto pelo código e confere a permissão do ator para a ação. */
export async function resolveProject(
  t: TxCtx,
  code: string,
  action: Action,
): Promise<ProjectRef> {
  const parsed = ProjectCode.safeParse(code);
  if (!parsed.success) {
    throw badRequest(
      "Código de projeto inválido: use de 2 a 8 letras maiúsculas ou números, como HUB.",
    );
  }
  const row = await maybeOne<ProjectRef & { member_role: ProjectRole | null }>(
    t,
    `select p.id, p.code, p.name, p.status, p.require_evidence, p.workspace_id,
            pm.role as member_role
       from ${S}.projects p
       left join ${S}.project_members pm on pm.project_id = p.id and pm.profile_id = $2
      where p.code = $1`,
    [parsed.data, t.actor.type === "user" ? t.actor.id : null],
  );
  if (!row)
    throw notFound(`Projeto ${parsed.data} não encontrado neste workspace.`);
  authorize(t.actor, action, {
    projectId: row.id,
    projectRole: row.member_role,
  });
  return row;
}

/** Responsável indicado: "me" (quem age) ou uma pessoa ou agente do workspace. */
export type AssigneeRef = "me" | { type: "user" | "agent"; id: string };

export async function resolveAssignee(
  t: TxCtx,
  input: AssigneeRef,
): Promise<{ type: "user" | "agent"; id: string }> {
  if (input === "me") {
    if (t.actor.type === "system" || !t.actor.id) {
      throw badRequest('assignee "me" exige uma pessoa ou um agente.');
    }
    return { type: t.actor.type, id: t.actor.id };
  }
  if (input.type === "user") {
    const member = await maybeOne(
      t,
      `select 1 from ${S}.memberships where profile_id = $1 and status = 'active'`,
      [input.id],
    );
    if (!member) {
      throw unprocessable("A pessoa indicada não faz parte deste workspace.");
    }
  } else {
    const agent = await maybeOne<{ status: string }>(
      t,
      `select status from ${S}.agents where id = $1`,
      [input.id],
    );
    if (!agent || agent.status === "revoked") {
      throw unprocessable("O agente indicado não existe ou foi revogado.");
    }
  }
  return input;
}

/** Confere a permissão sobre um projeto já conhecido pelo id. */
export async function authorizeProjectId(
  t: TxCtx,
  projectId: string,
  action: Action,
): Promise<void> {
  const role =
    t.actor.type === "user"
      ? ((
          await maybeOne<{ role: ProjectRole }>(
            t,
            `select role from ${S}.project_members where project_id = $1 and profile_id = $2`,
            [projectId, t.actor.id],
          )
        )?.role ?? null)
      : null;
  authorize(t.actor, action, { projectId, projectRole: role });
}
