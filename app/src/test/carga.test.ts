import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserActor } from "@/lib/db/actor";
import { pgDb } from "@/lib/db/pg";
import type { Db } from "@/lib/db/types";
import { inTx, type Ctx } from "@/modules/context";
import { projectChangeMarker } from "@/modules/live";
import { projectTaskList, type TaskListFilter } from "@/modules/tasks/board";
import { listSavedViews } from "@/modules/views/service";

/**
 * Teste de carga leve (M8): a Lista e o Quadro do projeto com 5 mil tarefas, p95 abaixo
 * de 400 ms. As duas telas leem os dados pela mesma transação (`projectTaskList`, as
 * visões salvas e a marca de mudança); o teste mede essa transação como a tela faz, com
 * o papel do app e a RLS valendo.
 *
 * Só roda com HUB_CARGA_DATABASE_URL: um Postgres descartável, com as migrations e os
 * seeds aplicados. Nunca aponte para a produção: o teste cria o cliente "carga-exemplo",
 * o projeto CRG e 5 mil tarefas. O passo a passo está em docs/operacao.md.
 */

const URL = process.env.HUB_CARGA_DATABASE_URL;
const S = "proj_hub_gestao";
const ROLE = "hub_carga_app";
const TASKS = 5000;
const RUNS = 60;
const WARMUP = 10;

let db: Db;
let raw: Db;
let ctx: Ctx;
let projectId: string;
let workstreamId: string;

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
}

async function measure(filter: TaskListFilter, openLimit?: number) {
  const once = () =>
    inTx(ctx, async (t) => {
      await projectTaskList(t, "CRG", filter, { openLimit });
      await listSavedViews(t, projectId, "list");
      await projectChangeMarker(t, "CRG");
    });
  for (let i = 0; i < WARMUP; i++) await once();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await once();
    times.push(performance.now() - start);
  }
  return {
    p50: Math.round(percentile(times, 50)),
    p95: Math.round(percentile(times, 95)),
    max: Math.round(Math.max(...times)),
  };
}

describe.skipIf(!URL)("carga: Lista e Quadro com 5 mil tarefas", () => {
  beforeAll(async () => {
    raw = pgDb(URL!);
    // O papel do app, como em produção: sem login próprio e sem passar por cima da RLS.
    await raw.query(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
          create role ${ROLE} nologin nobypassrls;
        end if;
      end
      $$;
      grant usage on schema ${S} to ${ROLE};
      grant select, insert, update, delete on all tables in schema ${S} to ${ROLE};
      grant usage, select on all sequences in schema ${S} to ${ROLE};
      grant execute on all functions in schema ${S} to ${ROLE};
    `);
    db = pgDb(URL!, ROLE);
    const base = (
      await raw.query<{ ws: string; owner: string }>(
        `select w.id as ws, m.profile_id as owner
           from ${S}.workspaces w
           join ${S}.memberships m on m.workspace_id = w.id and m.role = 'owner'
          where w.slug = 'harmony'`,
      )
    ).rows[0];
    const owner: UserActor = {
      type: "user",
      id: base.owner,
      scope: "internal",
      role: "owner",
      workspaceId: base.ws,
      name: "Dono (carga)",
    };
    ctx = { db, actor: owner, source: "ui", requestId: "teste-de-carga" };

    const existing = (
      await raw.query<{ id: string }>(
        `select id from ${S}.projects where code = 'CRG'`,
      )
    ).rows[0];
    if (existing) {
      projectId = existing.id;
    } else {
      const client = (
        await raw.query<{ id: string }>(
          `insert into ${S}.clients (workspace_id, slug, name)
           values ($1, 'carga-exemplo', 'Cliente de carga (exemplo)') returning id`,
          [base.ws],
        )
      ).rows[0];
      projectId = (
        await raw.query<{ id: string }>(
          `insert into ${S}.projects
             (workspace_id, client_id, code, name, status, owner_profile_id, require_evidence)
           values ($1, $2, 'CRG', 'Projeto de carga (exemplo)', 'active', $3, false)
           returning id`,
          [base.ws, client.id, base.owner],
        )
      ).rows[0].id;
      await raw.query(
        `insert into ${S}.task_statuses
           (workspace_id, project_id, name, color, category, sort_order, is_default)
         select $1, $2, s ->> 'name', s ->> 'color', (s ->> 'category')::${S}.status_category,
                (s ->> 'sort_order')::int, (s ->> 'is_default')::boolean
           from ${S}.workspaces w, jsonb_array_elements(w.settings -> 'default_task_statuses') s
          where w.id = $1`,
        [base.ws, projectId],
      );
      await raw.query(
        `insert into ${S}.workstreams (workspace_id, project_id, title, sort_order)
         select $1, $2, 'Frente ' || g, g from generate_series(1, 12) g`,
        [base.ws, projectId],
      );
      // 5 mil tarefas espalhadas pelos status, frentes, prioridades, responsáveis e prazos.
      await raw.query(
        `with st as (
           select array_agg(id order by sort_order) as ids,
                  array_agg(category::text order by sort_order) as cats
             from ${S}.task_statuses where project_id = $2),
         ws as (
           select array_agg(id order by sort_order) as ids
             from ${S}.workstreams where project_id = $2)
         insert into ${S}.tasks
           (workspace_id, project_id, workstream_id, code, title, status_id, priority,
            assignee_type, assignee_id, due_date, sort_key, done_evidence, created_by_type, created_by_id)
         select $1, $2, ws.ids[1 + g % 12], 'CRG-' || g, 'Tarefa de carga ' || g,
                st.ids[1 + g % cardinality(st.ids)],
                (array['urgent', 'high', 'normal', 'low'])[1 + g % 4]::${S}.task_priority,
                case when g % 3 = 0 then 'user'::${S}.actor_type end,
                case when g % 3 = 0 then $3::uuid end,
                current_date + (g % 60 - 20), g,
                case when st.cats[1 + g % cardinality(st.ids)] = 'done' then 'evidência de carga' end,
                'user', $3
           from generate_series(1, ${TASKS}) g, st, ws`,
        [base.ws, projectId, base.owner],
      );
      // Algumas dependências entre tarefas (o Quadro mostra "Espera").
      await raw.query(
        `insert into ${S}.task_dependencies (workspace_id, task_id, blocks_task_id)
         select $1, a.id, b.id
           from generate_series(1, 300) g
           join ${S}.tasks a on a.code = 'CRG-' || (g * 7)
           join ${S}.tasks b on b.code = 'CRG-' || (g * 7 + 1)
         on conflict do nothing`,
        [base.ws],
      );
      await raw.query(`analyze ${S}.tasks`);
    }
    workstreamId = (
      await raw.query<{ id: string }>(
        `select id from ${S}.workstreams where project_id = $1 order by sort_order limit 1`,
        [projectId],
      )
    ).rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    await raw?.close();
  });

  it("p95 abaixo de 400 ms na tela de sempre e com os filtros", async () => {
    const total = (
      await raw.query<{ n: number }>(
        `select count(*)::int as n from ${S}.tasks where project_id = $1`,
        [projectId],
      )
    ).rows[0].n;
    expect(total).toBeGreaterThanOrEqual(TASKS);
    const results = {
      "Quadro (até 500 abertas)": await measure({}),
      "Lista (200 abertas por vez)": await measure({}, 200),
      "Lista, Comigo": await measure({ assignee: "me" }, 200),
      "Lista, uma frente": await measure({ workstream: workstreamId }, 200),
      "Lista, busca por título": await measure({ search: "carga 42" }, 200),
      "Lista, atrasadas": await measure({ due: "late" }, 200),
    };
    // O resultado vai para o registro do PLAN.md.
    console.table(results);
    for (const [name, r] of Object.entries(results)) {
      expect(r.p95, name).toBeLessThan(400);
    }
  }, 600_000);
});
