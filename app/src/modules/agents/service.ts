import { z } from "zod";
import {
  AGENT_SCOPES,
  bearerToken,
  FORBIDDEN_AGENT_SCOPES,
  generateAgentKey,
  isAgentScope,
  parseAgentKey,
  verifyAgentKey,
  type AgentScope,
} from "@/lib/agent-keys";
import { authorize } from "@/lib/authorize";
import { audit } from "@/lib/audit";
import { applyRuntimeRole, type Actor, type AgentActor } from "@/lib/db/actor";
import type { Db } from "@/lib/db/types";
import {
  badRequest,
  locked,
  notFound,
  unauthorized,
  unprocessable,
} from "@/lib/errors";
import {
  iso,
  isoOrNull,
  ProjectCode,
  RoleCode,
  Text,
  Timestamp,
  Uuid,
} from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";

// Autenticação ------------------------------------------------------------------------

type KeyLookupRow = {
  key_id: string;
  key_hash: string;
  agent_id: string;
  agent_name: string;
  agent_kind: AgentActor["kind"];
  agent_status: "active" | "paused" | "revoked";
  agent_roles: string[];
  workspace_id: string;
  scopes: string[];
  project_ids: string[] | null;
  expires_at: Date | string;
  revoked_at: Date | string | null;
};

const INVALID_KEY =
  "Chave de agente inválida. Envie Authorization: Bearer hub_ak_<prefixo>.<segredo>, com a chave criada pelo Fábio na tela Agentes.";

/**
 * Autentica um agente pela chave Bearer (PRD §8.2). Sem contexto de ator ainda, a busca
 * usa a função SECURITY DEFINER agent_key_lookup, que devolve só o necessário.
 * Pausado: 423 (kill switch). Revogado, vencido ou chave errada: 401.
 */
export async function authenticateAgent(
  db: Db,
  authorization: string | null,
  pepper: string,
  now: Date = new Date(),
): Promise<AgentActor> {
  const token = bearerToken(authorization);
  if (!token) throw unauthorized(INVALID_KEY);
  const parsed = parseAgentKey(token);
  if (!parsed) throw unauthorized(INVALID_KEY);

  const row = await db.transaction(async (tx) => {
    await applyRuntimeRole(db, tx);
    return (
      await tx.query<KeyLookupRow>(`select * from ${S}.agent_key_lookup($1)`, [
        parsed.prefix,
      ])
    ).rows[0];
  });
  if (!row || !verifyAgentKey(parsed.key, row.key_hash, pepper)) {
    throw unauthorized(INVALID_KEY);
  }
  if (row.revoked_at)
    throw unauthorized(
      "Esta chave foi revogada. Peça uma chave nova ao Fábio.",
    );
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    throw unauthorized("Esta chave venceu. Peça uma chave nova ao Fábio.");
  }
  if (row.agent_status === "revoked") {
    throw unauthorized("Este agente foi desativado no Hub.");
  }
  if (row.agent_status === "paused") {
    throw locked(
      "O Fábio pausou este agente. Nenhuma ação é aceita até ele reativar.",
    );
  }
  const scopes = row.scopes.filter((s) => isAgentScope(s));
  return {
    type: "agent",
    id: row.agent_id,
    scope: "internal",
    workspaceId: row.workspace_id,
    name: row.agent_name,
    keyId: row.key_id,
    kind: row.agent_kind,
    scopes,
    projectIds: scopes.includes("workspace:*") ? null : (row.project_ids ?? []),
    roles: row.agent_roles ?? [],
  };
}

/** Papel declarado pelo agente nesta escrita (D6: o Kratos acumula papéis). */
export function withActingRole(
  actor: Actor,
  role: string | null | undefined,
): Actor {
  if (!role) return actor;
  const parsed = RoleCode.safeParse(role);
  if (!parsed.success) {
    throw badRequest(
      "Papel inválido: use o código do catálogo AGENTES.md, como GP-01.",
    );
  }
  if (actor.type === "agent" && !actor.roles.includes(parsed.data)) {
    throw badRequest(
      `Este agente não tem o papel ${parsed.data}. Papéis cadastrados: ${actor.roles.join(", ") || "nenhum"}.`,
    );
  }
  return { ...actor, actingRole: parsed.data };
}

/** Marca o último uso da chave no máximo uma vez por minuto, para não pesar no banco. */
const lastTouch = new Map<string, number>();
export async function touchKey(
  t: TxCtx,
  keyId: string,
  now = Date.now(),
): Promise<void> {
  const last = lastTouch.get(keyId) ?? 0;
  if (now - last < 60_000) return;
  lastTouch.set(keyId, now);
  await t.tx.query(
    `update ${S}.agent_api_keys set last_used_at = now() where id = $1`,
    [keyId],
  );
}

// Quem sou eu ---------------------------------------------------------------------------

export const MeDto = z.object({
  actor: z.object({
    type: z.enum(["user", "agent", "system"]),
    id: Uuid.nullable(),
    name: z.string(),
    kind: z.string().nullable(),
    roles: z.array(z.string()),
    acting_role: z.string().nullable(),
  }),
  workspace: z.object({ id: Uuid, slug: z.string(), name: z.string() }),
  key: z
    .object({
      prefix: z.string(),
      scopes: z.array(z.string()),
      expires_at: Timestamp,
      last_used_at: Timestamp.nullable(),
    })
    .nullable(),
  projects: z.array(
    z.object({ code: ProjectCode, name: z.string(), status: z.string() }),
  ),
  all_projects: z.boolean(),
  budget: z
    .object({
      month_usd: z.number(),
      spent_usd: z.number(),
      remaining_usd: z.number(),
    })
    .nullable(),
});
export type MeDto = z.infer<typeof MeDto>;

export async function whoami(t: TxCtx): Promise<MeDto> {
  authorize(t.actor, "agent.read");
  const workspace = await maybeOne<{ id: string; slug: string; name: string }>(
    t,
    `select id, slug, name from ${S}.workspaces where id = $1`,
    [t.actor.workspaceId],
  );
  if (!workspace) throw notFound("Workspace não encontrado.");
  const allProjects = t.actor.type !== "agent" || t.actor.projectIds === null;
  const projects = await many<{ code: string; name: string; status: string }>(
    t,
    allProjects
      ? `select code, name, status from ${S}.projects where archived_at is null order by code`
      : `select code, name, status from ${S}.projects
          where archived_at is null and id = any($1::uuid[]) order by code`,
    allProjects ? [] : [t.actor.type === "agent" ? t.actor.projectIds : []],
  );

  let key: MeDto["key"] = null;
  let budget: MeDto["budget"] = null;
  let kind: string | null = null;
  if (t.actor.type === "agent") {
    kind = t.actor.kind;
    const k = await maybeOne<{
      key_prefix: string;
      scopes: string[];
      expires_at: Date | string;
      last_used_at: Date | string | null;
    }>(
      t,
      `select key_prefix, scopes, expires_at, last_used_at from ${S}.agent_api_keys where id = $1`,
      [t.actor.keyId],
    );
    if (k) {
      key = {
        prefix: k.key_prefix,
        scopes: k.scopes,
        expires_at: iso(k.expires_at),
        last_used_at: isoOrNull(k.last_used_at),
      };
    }
    const b = await maybeOne<{ budget: number; spent: number }>(
      t,
      `select budget_usd_month as budget, spent_usd_month as spent from ${S}.agents where id = $1`,
      [t.actor.id],
    );
    if (b) {
      budget = {
        month_usd: b.budget,
        spent_usd: b.spent,
        remaining_usd: Math.max(
          0,
          Math.round((b.budget - b.spent) * 100) / 100,
        ),
      };
    }
  }
  return {
    actor: {
      type: t.actor.type,
      id: t.actor.id,
      name: t.actor.name,
      kind,
      roles: t.actor.type === "agent" ? t.actor.roles : [],
      acting_role: t.actor.actingRole ?? null,
    },
    workspace,
    key,
    projects,
    all_projects: allProjects,
    budget,
  };
}

// Cadastro de agentes e chaves (pessoas, pela interface; M3 traz as telas) -------------

export const CreateAgentInput = z.strictObject({
  name: Text(80),
  kind: z.enum(["hermes", "internal", "session", "integration"]),
  department: z.string().optional(),
  mission: z.string().trim().max(2000).optional(),
  roles: z.array(RoleCode).max(20).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  budget_usd_month: z.number().min(0).max(10_000).optional(),
});
export type CreateAgentInput = z.infer<typeof CreateAgentInput>;

export async function createAgent(
  t: TxCtx,
  input: CreateAgentInput,
): Promise<{ id: string; name: string }> {
  authorize(t.actor, "agent.manage");
  const department = input.department
    ? await maybeOne<{ id: string }>(
        t,
        `select id from ${S}.departments where slug = $1`,
        [input.department],
      )
    : null;
  if (input.department && !department) {
    throw unprocessable(`Departamento "${input.department}" não existe.`);
  }
  const row = await maybeOne<{ id: string; name: string }>(
    t,
    `insert into ${S}.agents
       (workspace_id, name, kind, department_id, mission, roles, config, budget_usd_month, owner_profile_id)
     values ($1, $2, $3, $4, $5, $6::text[], $7::jsonb, $8, $9)
     returning id, name`,
    [
      t.actor.workspaceId,
      input.name,
      input.kind,
      department?.id ?? null,
      input.mission ?? null,
      input.roles ?? [],
      json(input.config ?? {}),
      input.budget_usd_month ?? 0,
      t.actor.type === "user" ? t.actor.id : null,
    ],
  );
  await audit(t, {
    action: "agent.created",
    entityType: "agent",
    entityId: row!.id,
    after: { name: input.name, kind: input.kind, roles: input.roles ?? [] },
  });
  return row!;
}

export const CreateKeyInput = z.strictObject({
  agent_id: Uuid,
  scopes: z.array(z.string()).min(1).max(AGENT_SCOPES.length),
  projects: z.union([z.literal("all"), z.array(ProjectCode).min(1)]),
  expires_in_days: z.number().int().min(1).max(365).default(90),
});
export type CreateKeyInput = z.input<typeof CreateKeyInput>;

export type CreatedKey = {
  key: string;
  key_id: string;
  prefix: string;
  scopes: AgentScope[];
  projects: string[] | "all";
  expires_at: string;
};

/**
 * Cria a chave de um agente (owner). O valor completo só aparece nesta resposta;
 * no banco fica o hash. Nunca vai para log, auditoria ou mensagem.
 */
export async function createAgentKey(
  t: TxCtx,
  raw: CreateKeyInput,
  pepper: string,
): Promise<CreatedKey> {
  authorize(t.actor, "agent.keys");
  const input = CreateKeyInput.parse(raw);
  const forbidden = input.scopes.filter((s) =>
    (FORBIDDEN_AGENT_SCOPES as readonly string[]).includes(s),
  );
  if (forbidden.length > 0) {
    throw unprocessable(
      `Escopo proibido para agentes: ${forbidden.join(", ")}.`,
    );
  }
  const unknown = input.scopes.filter((s) => !isAgentScope(s));
  if (unknown.length > 0) {
    throw badRequest(
      `Escopo desconhecido: ${unknown.join(", ")}. Opções: ${AGENT_SCOPES.join(", ")}.`,
    );
  }
  const scopes = [...new Set(input.scopes)] as AgentScope[];
  if (input.projects === "all" && !scopes.includes("workspace:*")) {
    throw badRequest(
      'Acesso a todos os projetos exige o escopo "workspace:*".',
    );
  }
  const agent = await maybeOne<{ id: string; name: string; status: string }>(
    t,
    `select id, name, status from ${S}.agents where id = $1`,
    [input.agent_id],
  );
  if (!agent) throw notFound("Agente não encontrado neste workspace.");
  if (agent.status === "revoked")
    throw unprocessable("Agente revogado não recebe chave.");

  let projectIds: string[] | null = null;
  if (input.projects !== "all") {
    const rows = await many<{ id: string; code: string }>(
      t,
      `select id, code from ${S}.projects where code = any($1::text[])`,
      [input.projects],
    );
    const missing = input.projects.filter(
      (c) => !rows.some((r) => r.code === c),
    );
    if (missing.length > 0) {
      throw unprocessable(`Projeto não encontrado: ${missing.join(", ")}.`);
    }
    projectIds = rows.map((r) => r.id);
  }

  const generated = generateAgentKey(pepper);
  const row = await maybeOne<{ id: string; expires_at: Date | string }>(
    t,
    `insert into ${S}.agent_api_keys
       (workspace_id, agent_id, key_prefix, key_hash, scopes, project_ids, expires_at, created_by_profile_id)
     values ($1, $2, $3, $4, $5::text[], $6::uuid[], now() + make_interval(days => $7), $8)
     returning id, expires_at`,
    [
      t.actor.workspaceId,
      agent.id,
      generated.prefix,
      generated.hash,
      scopes,
      projectIds,
      input.expires_in_days,
      t.actor.type === "user" ? t.actor.id : null,
    ],
  );
  await audit(t, {
    action: "agent_key.created",
    entityType: "agent_key",
    entityId: row!.id,
    after: {
      agent: agent.name,
      prefix: generated.prefix,
      scopes,
      projects: input.projects,
      expires_at: iso(row!.expires_at),
    },
  });
  return {
    key: generated.key,
    key_id: row!.id,
    prefix: generated.prefix,
    scopes,
    projects: input.projects,
    expires_at: iso(row!.expires_at),
  };
}

export async function revokeAgentKey(t: TxCtx, keyId: string): Promise<void> {
  authorize(t.actor, "agent.keys");
  const row = await maybeOne<{ key_prefix: string }>(
    t,
    `update ${S}.agent_api_keys set revoked_at = now()
      where id = $1 and revoked_at is null
      returning key_prefix`,
    [keyId],
  );
  if (!row) throw notFound("Chave não encontrada ou já revogada.");
  await audit(t, {
    action: "agent_key.revoked",
    entityType: "agent_key",
    entityId: keyId,
    after: { prefix: row.key_prefix },
  });
}

/** Pausar e reativar um agente (kill switch do console, RF-31). */
export async function setAgentStatus(
  t: TxCtx,
  agentId: string,
  status: "active" | "paused" | "revoked",
): Promise<void> {
  authorize(t.actor, "agent.manage");
  const before = await maybeOne<{ status: string }>(
    t,
    `select status from ${S}.agents where id = $1 for update`,
    [agentId],
  );
  if (!before) throw notFound("Agente não encontrado neste workspace.");
  await t.tx.query(`update ${S}.agents set status = $2 where id = $1`, [
    agentId,
    status,
  ]);
  await audit(t, {
    action: "agent.status_changed",
    entityType: "agent",
    entityId: agentId,
    before: { status: before.status },
    after: { status },
  });
}
