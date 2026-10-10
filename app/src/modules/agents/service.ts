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
import { authorize, can } from "@/lib/authorize";
import { audit } from "@/lib/audit";
import { applyRuntimeRole, type Actor, type AgentActor } from "@/lib/db/actor";
import type { Db } from "@/lib/db/types";
import {
  badRequest,
  conflict,
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
  Line,
  Timestamp,
  Uuid,
} from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";
import { withDenialWho } from "./denials";

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
  // Chave conhecida: a recusa vai para a Sala de Controle (denials.ts).
  const who = {
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    keyPrefix: parsed.prefix,
  };
  if (row.revoked_at)
    throw withDenialWho(
      unauthorized("Esta chave foi revogada. Peça uma chave nova ao Fábio."),
      who,
    );
  if (new Date(row.expires_at).getTime() <= now.getTime()) {
    throw withDenialWho(
      unauthorized("Esta chave venceu. Peça uma chave nova ao Fábio."),
      who,
    );
  }
  if (row.agent_status === "revoked") {
    throw withDenialWho(
      unauthorized("Este agente foi desativado no Hub."),
      who,
    );
  }
  if (row.agent_status === "paused") {
    throw withDenialWho(
      locked(
        "O Fábio pausou este agente. Nenhuma ação é aceita até ele reativar.",
      ),
      who,
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
    keyPrefix: parsed.prefix,
    kind: row.agent_kind,
    scopes,
    // Lista de projetos guardada vale sempre; sem lista, workspace:* dá todos e o resto, nenhum.
    projectIds:
      row.project_ids !== null
        ? row.project_ids
        : scopes.includes("workspace:*")
          ? null
          : [],
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

/** true quando passou um minuto desde a última marcação desta chave (e reserva a vez). */
export function claimKeyTouch(keyId: string, now = Date.now()): boolean {
  const last = lastTouch.get(keyId) ?? 0;
  if (now - last < 60_000) return false;
  lastTouch.set(keyId, now);
  return true;
}

export async function touchKey(t: TxCtx, keyId: string): Promise<void> {
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
  name: Line(80),
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
  if (input.projects !== "all" && scopes.includes("workspace:*")) {
    throw badRequest(
      'O escopo "workspace:*" vale para todos os projetos. Para projetos específicos, use os escopos comuns.',
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

/**
 * Pausar e reativar um agente (kill switch do console, RF-31). Pausado, toda chamada dele
 * recebe 423 até alguém reativar. Revogado não volta pela tela. Repetir o mesmo status
 * não grava nada.
 */
export async function setAgentStatus(
  t: TxCtx,
  agentId: string,
  status: "active" | "paused" | "revoked",
): Promise<void> {
  authorize(t.actor, "agent.manage");
  if (!Uuid.safeParse(agentId).success) throw badRequest("Agente inválido.");
  const before = await maybeOne<{ status: string }>(
    t,
    `select status from ${S}.agents where id = $1 for update`,
    [agentId],
  );
  if (!before) throw notFound("Agente não encontrado neste workspace.");
  if (before.status === status) return;
  if (before.status === "revoked") {
    throw unprocessable(
      "Agente revogado não volta a operar. Cadastre um agente novo, com chave nova.",
    );
  }
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

export const UpdateAgentInput = z.strictObject({
  name: Line(80).optional(),
  /** Slug do departamento; null tira o departamento. */
  department: z.string().nullable().optional(),
  mission: z.string().trim().max(2000).nullable().optional(),
  budget_usd_month: z.number().min(0).max(10_000).optional(),
  /** Pessoa da equipe responsável pelo agente; null deixa sem ninguém. */
  owner: Uuid.nullable().optional(),
});
export type UpdateAgentInput = z.infer<typeof UpdateAgentInput>;

type AgentEditRow = {
  name: string;
  department: string | null;
  mission: string | null;
  budget: number;
  owner: string | null;
  status: string;
};

/**
 * Edita o cadastro de um agente (dono e administração): nome, departamento, missão,
 * orçamento de IA do mês e a pessoa responsável. Só o que mudou é gravado, com o antes e
 * o depois num registro `agent.updated`. Devolve os campos que mudaram.
 */
export async function updateAgent(
  t: TxCtx,
  agentId: string,
  raw: UpdateAgentInput,
): Promise<string[]> {
  authorize(t.actor, "agent.manage");
  if (!Uuid.safeParse(agentId).success) throw badRequest("Agente inválido.");
  const input = UpdateAgentInput.parse(raw);
  const row = await maybeOne<AgentEditRow>(
    t,
    `select a.name, d.slug as department, a.mission,
            a.budget_usd_month::float8 as budget, a.owner_profile_id as owner,
            a.status::text as status
       from ${S}.agents a
       left join ${S}.departments d on d.id = a.department_id
      where a.id = $1
      for update of a`,
    [agentId],
  );
  if (!row) throw notFound("Agente não encontrado neste workspace.");
  if (row.status === "revoked") {
    throw unprocessable("Agente revogado não é mais editado.");
  }

  const mission =
    input.mission === undefined ? undefined : input.mission || null;
  const next = {
    name: input.name ?? row.name,
    department:
      input.department === undefined ? row.department : input.department,
    mission: mission === undefined ? row.mission : mission,
    budget_usd_month: input.budget_usd_month ?? Number(row.budget),
    owner: input.owner === undefined ? row.owner : input.owner,
  };
  const current = {
    name: row.name,
    department: row.department,
    mission: row.mission,
    budget_usd_month: Number(row.budget),
    owner: row.owner,
  };
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
    (k) => next[k] !== current[k],
  );
  if (changed.length === 0) return [];

  let departmentId: string | null | undefined;
  if (changed.includes("department")) {
    departmentId = null;
    if (next.department) {
      const d = await maybeOne<{ id: string }>(
        t,
        `select id from ${S}.departments where workspace_id = $1 and slug = $2`,
        [t.actor.workspaceId, next.department],
      );
      if (!d)
        throw unprocessable(`Departamento "${next.department}" não existe.`);
      departmentId = d.id;
    }
  }
  if (changed.includes("owner") && next.owner) {
    const member = await maybeOne<{ id: string }>(
      t,
      `select p.id from ${S}.memberships m
         join ${S}.profiles p on p.id = m.profile_id
        where m.workspace_id = $1 and m.profile_id = $2 and m.status = 'active'
          and p.deactivated_at is null`,
      [t.actor.workspaceId, next.owner],
    );
    if (!member) {
      throw unprocessable(
        "O responsável precisa ser uma pessoa ativa da equipe.",
      );
    }
  }
  if (changed.includes("name")) {
    const same = await maybeOne<{ id: string }>(
      t,
      `select id from ${S}.agents where workspace_id = $1 and name = $2 and id <> $3`,
      [t.actor.workspaceId, next.name, agentId],
    );
    if (same) throw conflict(`Já existe um agente chamado "${next.name}".`);
  }

  await t.tx.query(
    `update ${S}.agents
        set name = $2,
            department_id = case when $3::boolean then $4::uuid else department_id end,
            mission = $5, budget_usd_month = $6, owner_profile_id = $7
      where id = $1`,
    [
      agentId,
      next.name,
      departmentId !== undefined,
      departmentId ?? null,
      next.mission,
      next.budget_usd_month,
      next.owner,
    ],
  );
  const pick = (from: typeof next) =>
    Object.fromEntries(changed.map((k) => [k, from[k]]));
  await audit(t, {
    action: "agent.updated",
    entityType: "agent",
    entityId: agentId,
    before: pick(current),
    after: pick(next),
  });
  return changed;
}

// Console de agentes (interface) ------------------------------------------------------

export type ConsoleKey = {
  id: string;
  prefix: string;
  scopes: string[];
  /** "all" = chave com workspace:*, válida para todos os projetos. */
  projects: string[] | "all";
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  state: "ativa" | "vencida" | "revogada";
};

export type ConsoleAgent = {
  id: string;
  name: string;
  kind: AgentActor["kind"];
  status: "active" | "paused" | "revoked";
  roles: string[];
  department: { slug: string; name: string } | null;
  mission: string | null;
  /** Orçamento de IA do mês, em dólares (0 = sem orçamento). */
  budgetUsdMonth: number;
  spentUsdMonth: number;
  owner: { id: string; name: string } | null;
  createdAt: string;
  keys: ConsoleKey[];
  /** Modelo de IA (D5): provedor e modelo para todos; chave e preços só para o dono. */
  ai: {
    provider: "anthropic" | "openai" | "xai";
    model: string;
    credentialId: string | null;
    credentialLabel: string | null;
    credentialLast4: string | null;
    credentialRevoked: boolean;
    priceIn: number | null;
    priceOut: number | null;
  } | null;
};

export type AgentsConsole = {
  agents: ConsoleAgent[];
  /** Pode cadastrar, editar e pausar agentes (owner e admin). */
  canManage: boolean;
  /** Pode ver, criar e revogar chaves (só o owner, decisão D9). */
  canManageKeys: boolean;
  /** Opções dos formulários (vazias para quem não gere agentes). */
  departments: { slug: string; name: string }[];
  people: { id: string; name: string }[];
};

type ConsoleAgentRow = {
  id: string;
  name: string;
  kind: AgentActor["kind"];
  status: ConsoleAgent["status"];
  roles: string[];
  department_slug: string | null;
  department_name: string | null;
  mission: string | null;
  budget: number;
  spent: number;
  owner_id: string | null;
  owner_name: string | null;
  created_at: Date | string;
  llm_provider: "anthropic" | "openai" | "xai" | null;
  llm_model: string | null;
  llm_credential_id: string | null;
  credential_label: string | null;
  credential_last4: string | null;
  credential_revoked: boolean | null;
  price_in: number | null;
  price_out: number | null;
};

type ConsoleKeyRow = {
  id: string;
  agent_id: string;
  key_prefix: string;
  scopes: string[];
  project_codes: string[] | null;
  all_projects: boolean;
  expires_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
};

/**
 * Lista do console de agentes. Toda a equipe vê os agentes; as chaves (prefixo, escopos,
 * projetos e validade) só aparecem para quem pode geri-las. O valor da chave nunca sai do
 * banco, onde só existe o hash.
 */
export async function listAgentsConsole(
  t: TxCtx,
  now = new Date(),
): Promise<AgentsConsole> {
  authorize(t.actor, "agent.read");
  const canManage = can(t.actor, "agent.manage");
  const canManageKeys = can(t.actor, "agent.keys");

  const agents = await many<ConsoleAgentRow>(
    t,
    `select a.id, a.name, a.kind::text as kind, a.status::text as status, a.roles,
            d.slug as department_slug, d.name as department_name, a.mission,
            a.budget_usd_month::float8 as budget, a.spent_usd_month::float8 as spent,
            p.id as owner_id, p.full_name as owner_name, a.created_at,
            a.llm_provider::text as llm_provider, a.llm_model, a.llm_credential_id,
            c.label as credential_label, c.key_last4 as credential_last4,
            c.revoked_at is not null as credential_revoked,
            nullif(a.config ->> 'llm_price_in', '')::float8 as price_in,
            nullif(a.config ->> 'llm_price_out', '')::float8 as price_out
       from ${S}.agents a
       left join ${S}.departments d on d.id = a.department_id
       left join ${S}.profiles p on p.id = a.owner_profile_id
       left join ${S}.llm_credentials c on c.id = a.llm_credential_id
      order by a.created_at, a.name`,
  );
  const keys = canManageKeys
    ? await many<ConsoleKeyRow>(
        t,
        `select k.id, k.agent_id, k.key_prefix, k.scopes, k.expires_at, k.last_used_at,
                k.revoked_at, k.created_at, k.project_ids is null as all_projects,
                (select array_agg(p.code order by p.code)
                   from ${S}.projects p where p.id = any(k.project_ids)) as project_codes
           from ${S}.agent_api_keys k
          order by k.created_at desc`,
      )
    : [];

  const toKey = (k: ConsoleKeyRow): ConsoleKey => {
    const expiresAt = iso(k.expires_at);
    const revokedAt = isoOrNull(k.revoked_at);
    return {
      id: k.id,
      prefix: k.key_prefix,
      scopes: k.scopes,
      projects: k.all_projects ? "all" : (k.project_codes ?? []),
      expiresAt,
      lastUsedAt: isoOrNull(k.last_used_at),
      revokedAt,
      createdAt: iso(k.created_at),
      state: revokedAt
        ? "revogada"
        : new Date(expiresAt) <= now
          ? "vencida"
          : "ativa",
    };
  };

  return {
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      status: a.status,
      roles: a.roles,
      department:
        a.department_slug && a.department_name
          ? { slug: a.department_slug, name: a.department_name }
          : null,
      mission: a.mission,
      budgetUsdMonth: Number(a.budget),
      spentUsdMonth: Number(a.spent),
      owner:
        a.owner_id && a.owner_name
          ? { id: a.owner_id, name: a.owner_name }
          : null,
      createdAt: iso(a.created_at),
      keys: keys.filter((k) => k.agent_id === a.id).map(toKey),
      ai:
        a.llm_provider && a.llm_model
          ? {
              provider: a.llm_provider,
              model: a.llm_model,
              // A chave e os preços só para quem gere chaves (o dono).
              credentialId: canManageKeys ? a.llm_credential_id : null,
              credentialLabel: canManageKeys ? a.credential_label : null,
              credentialLast4: canManageKeys ? a.credential_last4 : null,
              credentialRevoked: Boolean(a.credential_revoked),
              priceIn: canManageKeys ? a.price_in : null,
              priceOut: canManageKeys ? a.price_out : null,
            }
          : null,
    })),
    canManage,
    canManageKeys,
    departments: canManage
      ? await many<{ slug: string; name: string }>(
          t,
          `select slug, name from ${S}.departments
            where workspace_id = $1 order by sort_order, name`,
          [t.actor.workspaceId],
        )
      : [],
    people: canManage
      ? await many<{ id: string; name: string }>(
          t,
          `select p.id, p.full_name as name
             from ${S}.memberships m join ${S}.profiles p on p.id = m.profile_id
            where m.workspace_id = $1 and m.status = 'active' and p.deactivated_at is null
            order by p.full_name`,
          [t.actor.workspaceId],
        )
      : [],
  };
}
