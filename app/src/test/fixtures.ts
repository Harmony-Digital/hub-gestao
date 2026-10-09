import type { PGlite } from "@electric-sql/pglite";

/**
 * Dados de teste inseridos como superusuário (sem RLS), para depois testar o acesso
 * com o papel do app. Dois workspaces garantem que nada vaza de um para o outro.
 */
export type Fixture = {
  wsA: string;
  wsB: string;
  owner: string;
  member: string;
  clientContactProfile: string;
  clientA: string;
  projectA: string;
  projectInReview: string;
  projectB: string;
  statusTodo: string;
  statusDone: string;
  statusBlocked: string;
  milestoneClient: string;
  milestoneInternal: string;
  workstreamClient: string;
  workstreamInternal: string;
  agent: string;
};

async function one<T>(
  pg: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const r = await pg.query<T>(sql, params);
  return r.rows[0];
}

export async function seedFixture(pg: PGlite): Promise<Fixture> {
  const S = "proj_hub_gestao";
  const wsA = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.workspaces (slug, name) values ('harmony', 'Harmony Digital') returning id`,
    )
  ).id;
  const wsB = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.workspaces (slug, name, task_prefix) values ('outro', 'Outro workspace', 'OUT') returning id`,
    )
  ).id;

  const owner = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.profiles (email, full_name) values ('fabio@exemplo.com', 'Fábio') returning id`,
    )
  ).id;
  const member = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.profiles (email, full_name) values ('equipe@exemplo.com', 'Equipe') returning id`,
    )
  ).id;
  const clientContactProfile = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.profiles (email, full_name) values ('helena@cliente.com', 'Helena') returning id`,
    )
  ).id;
  await pg.query(
    `insert into ${S}.memberships (workspace_id, profile_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')`,
    [wsA, owner, member],
  );

  const clientA = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.clients (workspace_id, slug, name) values ($1, 'vitalis', 'Clínica Vitalis') returning id`,
      [wsA],
    )
  ).id;
  const clientB = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.clients (workspace_id, slug, name) values ($1, 'cliente-b', 'Cliente B') returning id`,
      [wsB],
    )
  ).id;
  await pg.query(
    `insert into ${S}.client_contacts (workspace_id, client_id, profile_id, name, email, access_status) values ($1, $2, $3, 'Helena', 'helena@cliente.com', 'active')`,
    [wsA, clientA, clientContactProfile],
  );

  const projectA = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.projects (workspace_id, client_id, code, name, status) values ($1, $2, 'VIT', 'Atendimento com IA', 'active') returning id`,
      [wsA, clientA],
    )
  ).id;
  const projectInReview = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.projects (workspace_id, client_id, code, name, status) values ($1, $2, 'NEW', 'Projeto importado', 'in_review') returning id`,
      [wsA, clientA],
    )
  ).id;
  const projectB = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.projects (workspace_id, client_id, code, name) values ($1, $2, 'BBB', 'Projeto do outro workspace') returning id`,
      [wsB, clientB],
    )
  ).id;

  const statuses = await pg.query<{ id: string; category: string }>(
    `insert into ${S}.task_statuses (workspace_id, project_id, name, category, sort_order, is_default)
     values ($1, $2, 'A fazer', 'todo', 1, true), ($1, $2, 'Concluída', 'done', 5, false), ($1, $2, 'Bloqueada', 'blocked', 4, false)
     returning id, category`,
    [wsA, projectA],
  );
  const statusTodo = statuses.rows.find((s) => s.category === "todo")!.id;
  const statusDone = statuses.rows.find((s) => s.category === "done")!.id;
  const statusBlocked = statuses.rows.find((s) => s.category === "blocked")!.id;

  const milestoneClient = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.milestones (workspace_id, project_id, code, title, title_client, visibility) values ($1, $2, 'M1', 'Agente no WhatsApp', 'Atendente virtual no WhatsApp', 'client') returning id`,
      [wsA, projectA],
    )
  ).id;
  const milestoneInternal = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.milestones (workspace_id, project_id, code, title, visibility) values ($1, $2, 'M2', 'Marco interno', 'internal') returning id`,
      [wsA, projectA],
    )
  ).id;

  const workstreamClient = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.workstreams (workspace_id, project_id, milestone_id, title, title_client, visibility) values ($1, $2, $3, 'Fluxo de atendimento', 'Como o atendimento funciona', 'client') returning id`,
      [wsA, projectA, milestoneClient],
    )
  ).id;
  const workstreamInternal = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.workstreams (workspace_id, project_id, milestone_id, title) values ($1, $2, $3, 'Integração com a agenda') returning id`,
      [wsA, projectA, milestoneClient],
    )
  ).id;

  const agent = (
    await one<{ id: string }>(
      pg,
      `insert into ${S}.agents (workspace_id, name, kind, roles) values ($1, 'Kratos', 'hermes', array['GP-01']) returning id`,
      [wsA],
    )
  ).id;

  return {
    wsA,
    wsB,
    owner,
    member,
    clientContactProfile,
    clientA,
    projectA,
    projectInReview,
    projectB,
    statusTodo,
    statusDone,
    statusBlocked,
    milestoneClient,
    milestoneInternal,
    workstreamClient,
    workstreamInternal,
    agent,
  };
}
