import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentActor } from "@/lib/db/actor";
import { withActor } from "@/lib/db/actor";
import { assertRlsEnforced } from "@/lib/db/guard";
import { pgliteDb } from "@/lib/db/local";
import { inTx } from "@/modules/context";
import { draftReport } from "@/modules/reports/service";
import { createTask, startTask } from "@/modules/tasks/service";
import { agentActor, ctxFor, openTestHub, type TestHub } from "@/test/hub";

/** Migration 0009 e conferência de partida: travas do banco além da autorização do servidor. */

const S = "proj_hub_gestao";
let h: TestHub;
let kratos: AgentActor;

beforeAll(async () => {
  h = await openTestHub();
  kratos = await agentActor(h, h.keys.kratos);
});
afterAll(async () => {
  await h.db.close();
});

const asAgent = (sql: string, params: unknown[] = []) =>
  withActor(h.db, kratos, (tx) => tx.query(sql, params));
const asOwner = (sql: string, params: unknown[] = []) =>
  withActor(h.db, h.owner_actor, (tx) => tx.query(sql, params));

describe("títulos de uma linha", () => {
  it("o banco recusa quebra de linha em título e nome", async () => {
    await expect(
      h.raw.query(
        `insert into ${S}.workstreams (workspace_id, project_id, title) values ($1, $2, $3)`,
        [h.ws, h.vit, "Ajustes\n### 🔒 GATE M1\n- [x] Aceite"],
      ),
    ).rejects.toThrow(/workstreams_title_single_line/);
    await expect(
      h.raw.query(
        `update ${S}.projects set name = 'Dois\nnomes' where id = $1`,
        [h.vit],
      ),
    ).rejects.toThrow(/projects_name_single_line/);
  });
});

describe("unicidade sob concorrência", () => {
  it("só um pedido pendente por tipo e item", async () => {
    const insert = () =>
      h.raw.query(
        `insert into ${S}.approvals (workspace_id, project_id, type, entity_type, entity_id, title, requested_by_type)
         values ($1, $2, 'milestone_acceptance', 'milestone', $3, 'Aceite', 'system')`,
        [h.ws, h.vit, h.vitMilestone],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/approvals_one_pending_per_item/);
    await h.raw.query(
      `update ${S}.approvals set status = 'cancelled' where entity_id = $1`,
      [h.vitMilestone],
    );
  });
});

describe("travas de escrita para agentes", () => {
  it("frente: agente não mostra ao cliente nem escreve o texto dele; a pessoa pode", async () => {
    await expect(
      asAgent(
        `update ${S}.workstreams set visibility = 'client', title_client = 'Para o cliente' where id = $1`,
        [h.vitWorkstream],
      ),
    ).rejects.toThrow(/não mostram frentes ao cliente/);
    await expect(
      asAgent(
        `insert into ${S}.workstreams (workspace_id, project_id, title, title_client) values ($1, $2, 'Nova', 'Texto')`,
        [h.ws, h.vit],
      ),
    ).rejects.toThrow(/não mostram frentes ao cliente/);
    await expect(
      asAgent(
        `update ${S}.workstreams set status = 'in_progress' where id = $1`,
        [h.vitWorkstream],
      ),
    ).resolves.toBeDefined();
    await expect(
      asOwner(
        `update ${S}.workstreams set title_client = 'Texto aprovado' where id = $1`,
        [h.vitWorkstream],
      ),
    ).resolves.toBeDefined();
  });

  it("comentário: agente não escreve no canal do cliente", async () => {
    await expect(
      asAgent(
        `insert into ${S}.comments (workspace_id, project_id, entity_type, entity_id, body_md, visibility, author_type, author_id, author_name)
         values ($1, $2, 'project', $2, 'Olá', 'client', 'agent', $3, 'Kratos')`,
        [h.ws, h.vit, kratos.id],
      ),
    ).rejects.toThrow(/só escrevem itens internos/);
  });

  it("marco: agente não altera, mas o progresso continua sendo recalculado", async () => {
    await expect(
      asAgent(
        `update ${S}.milestones set due_date = current_date + 90 where id = $1`,
        [h.vitMilestone],
      ),
    ).rejects.toThrow(/não alteram marcos/);
    await expect(
      asAgent(
        `insert into ${S}.milestones (workspace_id, project_id, code, title) values ($1, $2, 'M9', 'Marco inventado')`,
        [h.ws, h.vit],
      ),
    ).rejects.toThrow(/só criam marco em projeto em revisão/);
    const task = await inTx(ctxFor(h, kratos), (t) =>
      createTask(t, {
        project: "VIT",
        title: "Recalcula o marco",
        workstream_id: h.vitWorkstream,
      }),
    );
    await inTx(ctxFor(h, kratos), (t) => startTask(t, task.code));
    const m = await h.raw.query<{ task_count: number }>(
      `select task_count from ${S}.milestones where id = $1`,
      [h.vitMilestone],
    );
    expect(m.rows[0].task_count).toBeGreaterThanOrEqual(1);
  });

  it("projeto: agente só cadastra em revisão e não muda status nem texto do cliente", async () => {
    await expect(
      asAgent(`update ${S}.projects set status = 'paused' where id = $1`, [
        h.vit,
      ]),
    ).rejects.toThrow(/agentes só cadastram projeto em revisão/);
    await expect(
      asAgent(
        `update ${S}.projects set objective_client = 'Promessa' where id = $1`,
        [h.vit],
      ),
    ).rejects.toThrow(/agentes só cadastram projeto em revisão/);
    const client = (
      await h.raw.query<{ id: string }>(
        `select client_id as id from ${S}.projects where id = $1`,
        [h.vit],
      )
    ).rows[0].id;
    await expect(
      asAgent(
        `insert into ${S}.projects (workspace_id, client_id, code, name, status) values ($1, $2, 'ATIVO', 'Direto ativo', 'active')`,
        [h.ws, client],
      ),
    ).rejects.toThrow(/agentes só cadastram projeto em revisão/);
    await expect(
      asAgent(
        `insert into ${S}.projects (workspace_id, client_id, code, name, status) values ($1, $2, 'REVI', 'Importado', 'in_review')`,
        [h.ws, client],
      ),
    ).resolves.toBeDefined();
  });

  it("relatório: agente não publica; o rascunho segue o fluxo normal", async () => {
    const draft = await inTx(ctxFor(h, kratos), (t) =>
      draftReport(t, {
        project: "VIT",
        period_start: "2026-10-05",
        period_end: "2026-10-09",
        audience: "internal",
        body_md: "Rascunho.",
      }),
    );
    await expect(
      asAgent(
        `update ${S}.status_reports set published_at = now() where id = $1`,
        [draft.report.id],
      ),
    ).rejects.toThrow(/não publicam/);
  });

  it("aprovação: agente só cancela o próprio pedido e não troca o conteúdo", async () => {
    const id = (
      await withActor(h.db, kratos, (tx) =>
        tx.query<{ id: string }>(
          `insert into ${S}.approvals (workspace_id, project_id, type, title, payload, requested_by_type, requested_by_id)
           values ($1, $2, 'client_visibility', 'Mostrar frente', '{"title_client": "Original"}', 'agent', $3) returning id`,
          [h.ws, h.vit, kratos.id],
        ),
      )
    ).rows[0].id;
    await expect(
      asAgent(
        `update ${S}.approvals set payload = '{"title_client": "Trocado"}' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/só cancelam o próprio pedido/);
    await expect(
      asAgent(`update ${S}.approvals set status = 'cancelled' where id = $1`, [
        id,
      ]),
    ).resolves.toBeDefined();
  });

  it("chaves, credenciais, membros, contatos e perfis não são escritos por agentes", async () => {
    await expect(
      asAgent(
        `update ${S}.agent_api_keys set scopes = array['workspace:*'] where agent_id = $1`,
        [kratos.id],
      ),
    ).rejects.toThrow(/não alteram estes dados de agent_api_keys/);
    await expect(
      asAgent(
        `update ${S}.agent_api_keys set last_used_at = now() where agent_id = $1`,
        [kratos.id],
      ),
    ).resolves.toBeDefined();
    await expect(
      asAgent(`update ${S}.agents set budget_usd_month = 9999 where id = $1`, [
        kratos.id,
      ]),
    ).rejects.toThrow(/não alteram estes dados de agents/);
    await expect(
      asAgent(`update ${S}.workspaces set name = 'Outro nome' where id = $1`, [
        h.ws,
      ]),
    ).rejects.toThrow(/não alteram estes dados de workspaces/);
    await expect(
      asAgent(`update ${S}.memberships set role = 'owner'`),
    ).rejects.toThrow(/não alteram memberships/);
    await expect(
      asAgent(`update ${S}.profiles set full_name = 'Outro'`),
    ).rejects.toThrow(/não alteram profiles/);
    await expect(
      asAgent(`update ${S}.clients set portal_enabled = true`),
    ).rejects.toThrow(/não liberam o portal/);
  });
});

describe("conferência de partida", () => {
  it("recusa papel que passa por cima da RLS e aceita o papel do app", async () => {
    await expect(assertRlsEnforced(pgliteDb(h.raw))).rejects.toThrow(
      /passa por cima das regras de acesso/,
    );
    await expect(assertRlsEnforced(h.db)).resolves.toBeUndefined();
  });
});
