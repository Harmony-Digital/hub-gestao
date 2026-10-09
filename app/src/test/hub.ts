import type { PGlite } from "@electric-sql/pglite";
import type { Actor, AgentActor, UserActor } from "@/lib/db/actor";
import { applySeed, openLocalDatabase } from "@/lib/db/local";
import type { Db } from "@/lib/db/types";
import {
  authenticateAgent,
  createAgent,
  createAgentKey,
} from "@/modules/agents/service";
import { inTx, type Ctx, type Source } from "@/modules/context";

/**
 * Ambiente de teste do Hub: banco local (PGlite) com as migrations, o seed da Harmony,
 * um segundo projeto (VIT, de um cliente) e agentes com chaves criadas pelo caminho real.
 */

export const TEST_PEPPER =
  "pepper-de-teste-com-mais-de-32-caracteres-0123456789";
const S = "proj_hub_gestao";

export type TestHub = {
  db: Db;
  raw: PGlite;
  ws: string;
  owner: string;
  hub: string;
  vit: string;
  vitMilestone: string;
  vitWorkstream: string;
  agents: { kratos: string; executor: string; pausado: string };
  keys: { kratos: string; leitor: string; pausado: string; todos: string };
  owner_actor: UserActor;
};

export async function openTestHub(): Promise<TestHub> {
  const { db, raw } = await openLocalDatabase();
  await applySeed(raw);
  const one = async <T>(sql: string, params: unknown[] = []) =>
    (await raw.query<T>(sql, params)).rows[0];

  const ids = await one<{ ws: string; owner: string; hub: string }>(
    `select w.id as ws, m.profile_id as owner, p.id as hub
       from ${S}.workspaces w
       join ${S}.memberships m on m.workspace_id = w.id and m.role = 'owner'
       join ${S}.projects p on p.workspace_id = w.id and p.code = 'HUB'
      where w.slug = 'harmony'`,
  );

  // Segundo projeto, de um cliente fictício, para testar o escopo das chaves.
  const client = await one<{ id: string }>(
    `insert into ${S}.clients (workspace_id, slug, name) values ($1, 'clinica-exemplo', 'Clínica Exemplo') returning id`,
    [ids.ws],
  );
  const vit = await one<{ id: string }>(
    `insert into ${S}.projects (workspace_id, client_id, code, name, status) values ($1, $2, 'VIT', 'Atendimento com IA', 'active') returning id`,
    [ids.ws, client.id],
  );
  await raw.query(
    `insert into ${S}.task_statuses (workspace_id, project_id, name, color, category, sort_order, is_default)
     select $1, $2, s ->> 'name', s ->> 'color', (s ->> 'category')::${S}.status_category,
            (s ->> 'sort_order')::int, (s ->> 'is_default')::boolean
       from ${S}.workspaces w, jsonb_array_elements(w.settings -> 'default_task_statuses') s
      where w.id = $1`,
    [ids.ws, vit.id],
  );
  const vitMilestone = await one<{ id: string }>(
    `insert into ${S}.milestones (workspace_id, project_id, code, title, title_client, due_date, sort_order)
     values ($1, $2, 'M1', 'Agente no WhatsApp', 'Atendente virtual no WhatsApp', current_date + 30, 1) returning id`,
    [ids.ws, vit.id],
  );
  const vitWorkstream = await one<{ id: string }>(
    `insert into ${S}.workstreams (workspace_id, project_id, milestone_id, title)
     values ($1, $2, $3, 'Fluxo de atendimento') returning id`,
    [ids.ws, vit.id, vitMilestone.id],
  );

  const owner_actor: UserActor = {
    type: "user",
    id: ids.owner,
    scope: "internal",
    role: "owner",
    workspaceId: ids.ws,
    name: "Fábio Almeida",
  };
  const ownerCtx: Ctx = {
    db,
    actor: owner_actor,
    source: "ui",
    requestId: "setup",
  };

  const agents = await inTx(ownerCtx, async (t) => ({
    kratos: (
      await createAgent(t, {
        name: "Kratos",
        kind: "hermes",
        roles: ["GP-01", "VP-05"],
        budget_usd_month: 10,
      })
    ).id,
    executor: (await createAgent(t, { name: "Executor", kind: "session" })).id,
    pausado: (await createAgent(t, { name: "Pausado", kind: "session" })).id,
  }));
  const keys = await inTx(ownerCtx, async (t) => ({
    kratos: (
      await createAgentKey(
        t,
        {
          agent_id: agents.kratos,
          scopes: [
            "projects:read",
            "milestones:read",
            "tasks:read",
            "tasks:write",
            "tasks:complete",
            "workstreams:write",
            "comments:write",
            "approvals:request",
            "reports:draft",
            "time:write",
            "sync:plan",
          ],
          projects: ["VIT"],
        },
        TEST_PEPPER,
      )
    ).key,
    leitor: (
      await createAgentKey(
        t,
        {
          agent_id: agents.executor,
          scopes: ["tasks:read"],
          projects: ["VIT"],
        },
        TEST_PEPPER,
      )
    ).key,
    pausado: (
      await createAgentKey(
        t,
        { agent_id: agents.pausado, scopes: ["tasks:read"], projects: ["VIT"] },
        TEST_PEPPER,
      )
    ).key,
    todos: (
      await createAgentKey(
        t,
        { agent_id: agents.executor, scopes: ["workspace:*"], projects: "all" },
        TEST_PEPPER,
      )
    ).key,
  }));
  await raw.query(`update ${S}.agents set status = 'paused' where id = $1`, [
    agents.pausado,
  ]);

  return {
    db,
    raw,
    ws: ids.ws,
    owner: ids.owner,
    hub: ids.hub,
    vit: vit.id,
    vitMilestone: vitMilestone.id,
    vitWorkstream: vitWorkstream.id,
    agents,
    keys,
    owner_actor,
  };
}

export async function agentActor(h: TestHub, key: string): Promise<AgentActor> {
  return authenticateAgent(h.db, `Bearer ${key}`, TEST_PEPPER);
}

export function ctxFor(h: TestHub, actor: Actor, source: Source = "api"): Ctx {
  return {
    db: h.db,
    actor,
    source,
    requestId: `teste-${Math.random().toString(36).slice(2)}`,
  };
}

export async function count(
  h: TestHub,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  return (await h.raw.query<{ n: number }>(sql, params)).rows[0].n;
}
