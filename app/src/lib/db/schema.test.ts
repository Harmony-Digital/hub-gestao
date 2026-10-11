import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { listMigrations, openLocalDatabase } from "./local";
import { withActor, type Actor } from "./actor";
import type { Db, Queryable } from "./types";
import { seedFixture, type Fixture } from "@/test/fixtures";

const S = "proj_hub_gestao";
let db: Db;
let raw: PGlite;
let f: Fixture;

const internal = (ws: string, id: string): Actor => ({
  type: "user",
  id,
  scope: "internal",
  role: "owner",
  workspaceId: ws,
  name: "Fábio",
});
const client = (): Actor => ({
  type: "user",
  id: f.clientContactProfile,
  scope: "client",
  clientId: f.clientA,
  contactRole: "client_viewer",
  workspaceId: f.wsA,
  name: "Helena",
});
const system = (): Actor => ({
  type: "system",
  id: null,
  scope: "internal",
  workspaceId: f.wsA,
  name: "Hub",
});
const agent = (): Actor => ({
  type: "agent",
  id: f.agent,
  scope: "internal",
  keyId: "00000000-0000-4000-8000-000000000001",
  kind: "hermes",
  scopes: ["tasks:write", "approvals:request"],
  projectIds: null,
  roles: ["GP-01"],
  workspaceId: f.wsA,
  name: "Kratos",
});

async function newTask(
  ws: string,
  project: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  return withActor(db, internal(ws, f.owner), async (tx) => {
    const code = (
      await tx.query<{ code: string }>(
        `select ${S}.next_task_code($1) as code`,
        [ws],
      )
    ).rows[0].code;
    const cols = [
      "workspace_id",
      "project_id",
      "code",
      "title",
      "status_id",
      "created_by_type",
      "created_by_id",
      ...Object.keys(extra),
    ];
    const vals = [
      ws,
      project,
      code,
      `Tarefa ${code}`,
      status,
      "user",
      f.owner,
      ...Object.values(extra),
    ];
    const ph = vals.map((_, i) => `$${i + 1}`).join(", ");
    const r = await tx.query<{ id: string; code: string }>(
      `insert into ${S}.tasks (${cols.join(", ")}) values (${ph}) returning id, code`,
      vals,
    );
    return r.rows[0];
  });
}

beforeAll(async () => {
  ({ db, raw } = await openLocalDatabase());
  f = await seedFixture(raw);
});

afterAll(async () => {
  await db.close();
});

describe("migrations", () => {
  it("aplica as migrations do schema, em ordem", async () => {
    expect(await listMigrations()).toEqual([
      "hub_gestao_0001_foundation.sql",
      "hub_gestao_0002_work.sql",
      "hub_gestao_0003_agents_governance.sql",
      "hub_gestao_0004_rollups.sql",
      "hub_gestao_0005_advisor_hardening.sql",
      "hub_gestao_0006_human_decisions.sql",
      "hub_gestao_0007_project_agents.sql",
      "hub_gestao_0008_jobs_webhooks.sql",
      "hub_gestao_0009_review_hardening.sql",
      "hub_gestao_0010_auth_login.sql",
      "hub_gestao_0011_attachment_contents.sql",
      "hub_gestao_0012_agent_denials.sql",
      "hub_gestao_0013_blocked_on.sql",
      "hub_gestao_0014_evidence_on_complete.sql",
      "hub_gestao_0015_portal_access.sql",
      "hub_gestao_0016_portal_milestone_revisions.sql",
      "hub_gestao_0017_portal_client_channel.sql",
      "hub_gestao_0018_portal_milestone_receipt.sql",
      "hub_gestao_0019_agent_runs_project.sql",
      "hub_gestao_0020_custom_fields.sql",
      "hub_gestao_0021_privacy_retention.sql",
      "hub_gestao_0022_client_logos.sql",
      "hub_gestao_0023_workstream_derived_status.sql",
      "hub_gestao_0024_webhook_quiet_hours.sql",
      "hub_gestao_0026_attachments_25mb.sql",
    ]);
    const tables = await raw.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = '${S}'`,
    );
    expect(tables.rows[0].n).toBe(46);
  });

  it("liga RLS em todas as tabelas do schema", async () => {
    const r = await raw.query<{ tablename: string }>(
      `select c.relname as tablename from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = '${S}' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(r.rows).toEqual([]);
  });
});

// Os mesmos critérios dos alertas do Supabase, verificados a cada mudança de schema.
describe("alertas do Supabase", () => {
  it("tem uma única política permissiva por tabela e ação", async () => {
    const r = await raw.query<{ tablename: string; action: string }>(
      `with p as (
         select tablename, policyname,
                unnest(case cmd when 'ALL' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] else array[cmd] end) as action
           from pg_policies
          where schemaname = $1 and permissive = 'PERMISSIVE'
       )
       select tablename, action from p group by tablename, action having count(*) > 1`,
      [S],
    );
    expect(r.rows).toEqual([]);
  });

  it("calcula as funções de contexto uma vez por consulta, nunca linha a linha", async () => {
    const r = await raw.query<{ name: string; expr: string }>(
      `select tablename || '.' || policyname as name,
              coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
         from pg_policies where schemaname = $1`,
      [S],
    );
    const call =
      /(?:proj_hub_gestao\.)?(?:actor_is_internal|actor_is_client|current_workspace_id|current_actor_id|current_actor_type|current_client_id)\(\)/g;
    const perRow: string[] = [];
    for (const p of r.rows) {
      for (const m of p.expr.matchAll(call)) {
        if (p.expr.slice(Math.max(0, m.index - 7), m.index) !== "SELECT ") {
          perRow.push(p.name);
        }
      }
    }
    expect(r.rows.length).toBeGreaterThan(50);
    expect(perRow).toEqual([]);
  });

  it("toda chave estrangeira tem um índice que a cobre", async () => {
    const r = await raw.query<{ tbl: string; conname: string }>(
      `select c.conrelid::regclass::text as tbl, c.conname
         from pg_constraint c
         join pg_namespace n on n.oid = c.connamespace
        where c.contype = 'f' and n.nspname = $1
          and not exists (
            select 1 from pg_index i
             where i.indrelid = c.conrelid
               and (select array_agg(k order by k)
                      from unnest((string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)]) k)
                   = (select array_agg(k order by k) from unnest(c.conkey) k)
          )
        order by 1, 2`,
      [S],
    );
    expect(r.rows).toEqual([]);
  });
});

describe("regras de acesso (RLS)", () => {
  it("sem contexto de ator, o papel do app não vê nada", async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.query("set local role hub_app");
      return (await tx.query(`select id from ${S}.projects`)).rows;
    });
    expect(rows).toEqual([]);
  });

  it("isola os workspaces", async () => {
    const codes = await withActor(db, internal(f.wsA, f.owner), async (tx) =>
      (
        await tx.query<{ code: string }>(
          `select code from ${S}.projects order by code`,
        )
      ).rows.map((r) => r.code),
    );
    expect(codes).toEqual(["NEW", "VIT"]);
  });

  it("não deixa gravar em outro workspace", async () => {
    await expect(
      withActor(db, internal(f.wsA, f.owner), (tx) =>
        tx.query(
          `insert into ${S}.labels (workspace_id, name) values ($1, 'intrusa')`,
          [f.wsB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("o cliente vê só o próprio projeto ativo, os marcos e as frentes liberados", async () => {
    const seen = await withActor(db, client(), async (tx) => ({
      projects: (
        await tx.query<{ code: string }>(`select code from ${S}.projects`)
      ).rows.map((r) => r.code),
      milestones: (
        await tx.query<{ code: string }>(`select code from ${S}.milestones`)
      ).rows.map((r) => r.code),
      workstreams: (
        await tx.query<{ title: string }>(`select title from ${S}.workstreams`)
      ).rows.map((r) => r.title),
    }));
    expect(seen.projects).toEqual(["VIT"]);
    expect(seen.milestones).toEqual(["M1"]);
    expect(seen.workstreams).toEqual(["Fluxo de atendimento"]);
  });

  it("o cliente nunca vê tarefas, agentes, aprovações nem o registro de atividades", async () => {
    await newTask(f.wsA, f.projectA, f.statusTodo);
    const counts = await withActor(db, client(), async (tx) => {
      const c = async (t: string) =>
        (
          await tx.query<{ n: number }>(
            `select count(*)::int as n from ${S}.${t}`,
          )
        ).rows[0].n;
      return {
        tasks: await c("tasks"),
        agents: await c("agents"),
        approvals: await c("approvals"),
        log: await c("activity_log"),
      };
    });
    expect(counts).toEqual({ tasks: 0, agents: 0, approvals: 0, log: 0 });
  });

  it("o cliente comenta só no canal do próprio projeto, como ele mesmo", async () => {
    const insert = (visibility: string, author: string) =>
      withActor(db, client(), (tx) =>
        tx.query(
          `insert into ${S}.comments (workspace_id, project_id, entity_type, entity_id, body_md, visibility, author_type, author_id, author_name)
           values ($1, $2, 'project', $2, 'Olá', $3, 'user', $4, 'Helena')`,
          [f.wsA, f.projectA, visibility, author],
        ),
      );
    await expect(
      insert("client", f.clientContactProfile),
    ).resolves.toBeDefined();
    await expect(insert("internal", f.clientContactProfile)).rejects.toThrow(
      /row-level security/,
    );
    await expect(insert("client", f.owner)).rejects.toThrow(
      /row-level security/,
    );
  });

  it("comentário do projeto aponta para o próprio projeto", async () => {
    await expect(
      withActor(db, internal(f.wsA, f.owner), (tx) =>
        tx.query(
          `insert into ${S}.comments (workspace_id, project_id, entity_type, entity_id, body_md, author_type, author_id, author_name)
           values ($1, $2, 'project', $3, 'Nota', 'user', $4, 'Fábio')`,
          [f.wsA, f.projectA, f.milestoneClient, f.owner],
        ),
      ),
    ).rejects.toThrow(/comments_project_entity/);
  });

  it("a equipe de outro workspace não altera perfis daqui", async () => {
    const outsider = internal(f.wsB, "00000000-0000-4000-8000-0000000000bb");
    await withActor(db, outsider, (tx) =>
      tx.query(`update ${S}.profiles set full_name = 'Alterado de fora'`),
    );
    const r = await raw.query<{ full_name: string }>(
      `select full_name from ${S}.profiles where id = $1`,
      [f.owner],
    );
    expect(r.rows[0].full_name).toBe("Fábio");
  });

  it("o contato de cliente lê só o próprio cadastro no cliente em que entrou", async () => {
    const otherClient = (
      await raw.query<{ id: string }>(
        `insert into ${S}.clients (workspace_id, slug, name) values ($1, 'clinica-dois', 'Clínica Dois') returning id`,
        [f.wsA],
      )
    ).rows[0].id;
    await raw.query(
      `insert into ${S}.client_contacts (workspace_id, client_id, profile_id, name, email, access_status) values ($1, $2, $3, 'Helena', 'helena@cliente.com', 'active')`,
      [f.wsA, otherClient, f.clientContactProfile],
    );
    const rows = await withActor(
      db,
      client(),
      async (tx) =>
        (
          await tx.query<{ client_id: string }>(
            `select client_id from ${S}.client_contacts`,
          )
        ).rows,
    );
    expect(rows).toEqual([{ client_id: f.clientA }]);
  });
});

describe("tarefas", () => {
  it("gera códigos sequenciais por workspace", async () => {
    const a = await newTask(f.wsA, f.projectA, f.statusTodo);
    const b = await newTask(f.wsA, f.projectA, f.statusTodo);
    expect(Number(b.code.split("-")[1])).toBe(Number(a.code.split("-")[1]) + 1);
    expect(a.code.startsWith("HUB-")).toBe(true);
  });

  it("recusa concluir sem evidência quando o projeto exige", async () => {
    const t = await newTask(f.wsA, f.projectA, f.statusTodo);
    await expect(
      withActor(db, internal(f.wsA, f.owner), (tx) =>
        tx.query(`update ${S}.tasks set status_id = $1 where id = $2`, [
          f.statusDone,
          t.id,
        ]),
      ),
    ).rejects.toThrow(/evidência obrigatória/);
  });

  it("conclui com evidência, marca a data e limpa ao reabrir", async () => {
    const t = await newTask(f.wsA, f.projectA, f.statusTodo);
    const done = await withActor(
      db,
      internal(f.wsA, f.owner),
      async (tx) =>
        (
          await tx.query<{
            status_category: string;
            completed_at: Date | null;
            version: number;
          }>(
            `update ${S}.tasks set status_id = $1, done_evidence = 'commit 3f9a2c1' where id = $2 returning status_category, completed_at, version`,
            [f.statusDone, t.id],
          )
        ).rows[0],
    );
    expect(done.status_category).toBe("done");
    expect(done.completed_at).not.toBeNull();
    expect(done.version).toBe(2);
    const reopened = await withActor(
      db,
      internal(f.wsA, f.owner),
      async (tx) =>
        (
          await tx.query<{ completed_at: Date | null }>(
            `update ${S}.tasks set status_id = $1 where id = $2 returning completed_at`,
            [f.statusTodo, t.id],
          )
        ).rows[0],
    );
    expect(reopened.completed_at).toBeNull();
  });

  it("cobra a evidência ao concluir, sem travar a tarefa concluída antes da regra", async () => {
    const t = await newTask(f.wsA, f.projectA, f.statusTodo);
    const asOwner = <T>(fn: (tx: Queryable) => Promise<T>) =>
      withActor(db, internal(f.wsA, f.owner), fn);
    // Concluída sem evidência enquanto o projeto não exigia.
    await raw.query(
      `update ${S}.projects set require_evidence = false where id = $1`,
      [f.projectA],
    );
    try {
      await asOwner((tx) =>
        tx.query(`update ${S}.tasks set status_id = $1 where id = $2`, [
          f.statusDone,
          t.id,
        ]),
      );
    } finally {
      await raw.query(
        `update ${S}.projects set require_evidence = true where id = $1`,
        [f.projectA],
      );
    }
    // O projeto passou a exigir: a tarefa continua editável (título, posição, status da
    // mesma categoria), sem pedir evidência de novo.
    const renamed = await asOwner(
      async (tx) =>
        (
          await tx.query<{ title: string; status_category: string }>(
            `update ${S}.tasks set title = 'Renomeada', sort_key = sort_key + 1
              where id = $1 returning title, status_category`,
            [t.id],
          )
        ).rows[0],
    );
    expect(renamed).toEqual({ title: "Renomeada", status_category: "done" });
    // Trocar a evidência por vazio continua recusado.
    await expect(
      asOwner((tx) =>
        tx.query(`update ${S}.tasks set done_evidence = ' ' where id = $1`, [
          t.id,
        ]),
      ),
    ).rejects.toThrow(/evidência obrigatória/);
  });

  it("não aceita status de outro projeto", async () => {
    const otherStatus = (
      await raw.query<{ id: string }>(
        `insert into ${S}.task_statuses (workspace_id, project_id, name, category) values ($1, $2, 'A fazer', 'todo') returning id`,
        [f.wsA, f.projectInReview],
      )
    ).rows[0].id;
    await expect(newTask(f.wsA, f.projectA, otherStatus)).rejects.toThrow();
  });
});

describe("registro de atividades", () => {
  it("é só inserção, até para o superusuário", async () => {
    await withActor(db, internal(f.wsA, f.owner), (tx) =>
      tx.query(
        `insert into ${S}.activity_log (workspace_id, actor_type, actor_id, source, action, entity_type) values ($1, 'user', $2, 'api', 'teste', 'task')`,
        [f.wsA, f.owner],
      ),
    );
    await expect(
      raw.query(`update ${S}.activity_log set action = 'alterada'`),
    ).rejects.toThrow(/somente inserção/);
    await expect(raw.query(`delete from ${S}.activity_log`)).rejects.toThrow(
      /somente inserção/,
    );
  });

  it("aceita linha só em nome do próprio ator", async () => {
    const log = (actorType: string, actorId: string) =>
      withActor(db, agent(), (tx) =>
        tx.query(
          `insert into ${S}.activity_log (workspace_id, actor_type, actor_id, source, action, entity_type) values ($1, $2, $3, 'mcp', 'teste', 'task')`,
          [f.wsA, actorType, actorId],
        ),
      );
    await expect(log("agent", f.agent)).resolves.toBeDefined();
    await expect(log("user", f.owner)).rejects.toThrow(/row-level security/);
  });
});

describe("progresso", () => {
  it("recalcula frente, marco e projeto", async () => {
    const ws = f.workstreamClient;
    await newTask(f.wsA, f.projectA, f.statusTodo, { workstream_id: ws });
    await newTask(f.wsA, f.projectA, f.statusTodo, { workstream_id: ws });
    await newTask(f.wsA, f.projectA, f.statusDone, {
      workstream_id: ws,
      done_evidence: "PR #1",
    });
    await newTask(f.wsA, f.projectA, f.statusDone, {
      workstream_id: ws,
      done_evidence: "PR #2",
    });
    await withActor(db, internal(f.wsA, f.owner), (tx) =>
      tx.query(`select ${S}.recompute_project_rollup($1)`, [f.projectA]),
    );
    const r = await raw.query<{
      progress_pct: number;
      task_count: number;
      done_count: number;
    }>(
      `select progress_pct, task_count, done_count from ${S}.workstreams where id = $1`,
      [ws],
    );
    expect(r.rows[0]).toEqual({
      progress_pct: 50,
      task_count: 4,
      done_count: 2,
    });
    const m = await raw.query<{ progress_pct: number }>(
      `select progress_pct from ${S}.milestones where id = $1`,
      [f.milestoneClient],
    );
    expect(m.rows[0].progress_pct).toBe(50);
  });

  it("o cliente lê o progresso da frente liberada sem ver as tarefas", async () => {
    const r = await withActor(
      db,
      client(),
      async (tx) =>
        (
          await tx.query<{ progress_pct: number }>(
            `select progress_pct from ${S}.workstreams`,
          )
        ).rows,
    );
    expect(r).toEqual([{ progress_pct: 50 }]);
  });
});

describe("decisões humanas", () => {
  const request = () =>
    withActor(
      db,
      agent(),
      async (tx) =>
        (
          await tx.query<{ id: string }>(
            `insert into ${S}.approvals (workspace_id, project_id, type, title, requested_by_type, requested_by_id, acting_role)
             values ($1, $2, 'milestone_acceptance', 'Aceite do marco M2', 'agent', $3, 'GP-01') returning id`,
            [f.wsA, f.projectA, f.agent],
          )
        ).rows[0].id,
    );
  const decide = (actor: Actor, id: string, status: string, by: string) =>
    withActor(db, actor, (tx) =>
      tx.query(
        `update ${S}.approvals set status = $2, decided_by_profile_id = $3, decided_at = now() where id = $1`,
        [id, status, by],
      ),
    );

  it("o agente pede, mas não decide", async () => {
    const id = await request();
    // Para agente, a trava da 0009 dispara primeiro; para o sistema, a da 0006.
    await expect(decide(agent(), id, "approved", f.owner)).rejects.toThrow(
      /somente uma pessoa decide|só cancelam o próprio pedido/,
    );
    await expect(decide(system(), id, "approved", f.owner)).rejects.toThrow(
      /somente uma pessoa decide/,
    );
  });

  it("a pessoa decide só em nome próprio", async () => {
    const id = await request();
    await expect(
      decide(internal(f.wsA, f.owner), id, "approved", f.member),
    ).rejects.toThrow(/somente uma pessoa decide/);
    await expect(
      decide(internal(f.wsA, f.owner), id, "approved", f.owner),
    ).resolves.toBeDefined();
  });

  it("decisão registrada não muda; o efeito pode ser anotado", async () => {
    const id = await request();
    await decide(internal(f.wsA, f.owner), id, "rejected", f.owner);
    await expect(
      decide(internal(f.wsA, f.owner), id, "approved", f.owner),
    ).rejects.toThrow(/já encerrada/);
    await expect(
      withActor(db, internal(f.wsA, f.owner), (tx) =>
        tx.query(
          `update ${S}.approvals set effect = '{"aplicado": false}' where id = $1`,
          [id],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("o agente pode cancelar o próprio pedido pendente", async () => {
    const id = await request();
    await expect(
      withActor(db, agent(), (tx) =>
        tx.query(
          `update ${S}.approvals set status = 'cancelled' where id = $1`,
          [id],
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("só uma pessoa aceita um marco ou desfaz o aceite", async () => {
    const accept = (actor: Actor, by: string) =>
      withActor(db, actor, (tx) =>
        tx.query(
          `update ${S}.milestones set status = 'accepted', accepted_by_profile_id = $2, accepted_at = now() where id = $1`,
          [f.milestoneInternal, by],
        ),
      );
    const reopen = (actor: Actor) =>
      withActor(
        db,
        actor,
        async (tx) =>
          (
            await tx.query<{
              accepted_at: Date | null;
              accepted_by_profile_id: string | null;
            }>(
              `update ${S}.milestones set status = 'delivered' where id = $1 returning accepted_at, accepted_by_profile_id`,
              [f.milestoneInternal],
            )
          ).rows[0],
      );

    await expect(accept(agent(), f.owner)).rejects.toThrow(
      /somente uma pessoa aceita|não alteram marcos/,
    );
    await expect(accept(system(), f.owner)).rejects.toThrow(
      /somente uma pessoa aceita/,
    );
    await expect(accept(internal(f.wsA, f.owner), f.member)).rejects.toThrow(
      /somente uma pessoa aceita/,
    );
    await expect(
      accept(internal(f.wsA, f.owner), f.owner),
    ).resolves.toBeDefined();
    await expect(
      withActor(db, internal(f.wsA, f.owner), (tx) =>
        tx.query(
          `update ${S}.milestones set accepted_by_profile_id = $2 where id = $1`,
          [f.milestoneInternal, f.member],
        ),
      ),
    ).rejects.toThrow(/aceite registrado/);
    await expect(reopen(agent())).rejects.toThrow(
      /somente uma pessoa desfaz|não alteram marcos/,
    );
    await expect(reopen(system())).rejects.toThrow(/somente uma pessoa desfaz/);
    expect(await reopen(internal(f.wsA, f.owner))).toEqual({
      accepted_at: null,
      accepted_by_profile_id: null,
    });
  });
});

describe("agentes por projeto", () => {
  it("liga o agente ao projeto com um papel do catálogo", async () => {
    await withActor(db, internal(f.wsA, f.owner), (tx) =>
      tx.query(
        `insert into ${S}.project_agents (workspace_id, project_id, agent_id, role) values ($1, $2, $3, 'GP-01'), ($1, $2, $3, 'VP-05')`,
        [f.wsA, f.projectA, f.agent],
      ),
    );
    const roles = await withActor(db, internal(f.wsA, f.owner), async (tx) =>
      (
        await tx.query<{ role: string }>(
          `select role from ${S}.project_agents where project_id = $1 order by role`,
          [f.projectA],
        )
      ).rows.map((r) => r.role),
    );
    expect(roles).toEqual(["GP-01", "VP-05"]);
  });

  it("não liga agente a projeto de outro workspace nem aceita papel fora do padrão", async () => {
    await expect(
      raw.query(
        `insert into ${S}.project_agents (workspace_id, project_id, agent_id, role) values ($1, $2, $3, 'GP-01')`,
        [f.wsB, f.projectB, f.agent],
      ),
    ).rejects.toThrow(/foreign key/);
    await expect(
      raw.query(
        `insert into ${S}.project_agents (workspace_id, project_id, agent_id, role) values ($1, $2, $3, 'gestor')`,
        [f.wsA, f.projectA, f.agent],
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe("chaves de agente", () => {
  it("recusa escopos proibidos para agentes", async () => {
    await expect(
      raw.query(
        `insert into ${S}.agent_api_keys (workspace_id, agent_id, key_prefix, key_hash, scopes, expires_at)
         values ($1, $2, 'hub_ak_abcdefgh', repeat('a', 64), array['approvals:decide'], now() + interval '1 day')`,
        [f.wsA, f.agent],
      ),
    ).rejects.toThrow(/agent_api_keys_forbidden_scopes/);
  });

  it("a consulta de autenticação funciona sem contexto, só pelo prefixo", async () => {
    const agent = (
      await raw.query<{ id: string }>(
        `insert into ${S}.agents (workspace_id, name, kind) values ($1, 'Claude Code', 'session') returning id`,
        [f.wsA],
      )
    ).rows[0].id;
    await raw.query(
      `insert into ${S}.agent_api_keys (workspace_id, agent_id, key_prefix, key_hash, scopes, expires_at)
       values ($1, $2, 'hub_ak_lookup01', repeat('b', 64), array['tasks:read'], now() + interval '1 day')`,
      [f.wsA, agent],
    );
    const rows = await db.transaction(async (tx) => {
      await tx.query("set local role hub_app");
      return (
        await tx.query<{ agent_name: string; workspace_id: string }>(
          `select agent_name, workspace_id from ${S}.agent_key_lookup($1)`,
          ["hub_ak_lookup01"],
        )
      ).rows;
    });
    expect(rows).toEqual([{ agent_name: "Claude Code", workspace_id: f.wsA }]);
  });
});
