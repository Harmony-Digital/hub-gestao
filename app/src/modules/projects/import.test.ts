import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentActor } from "@/lib/db/actor";
import { HubError } from "@/lib/errors";
import {
  approveImportsInBatch,
  decideApproval,
  requestApproval,
} from "@/modules/approvals/service";
import { inTx } from "@/modules/context";
import {
  agentActor,
  count,
  ctxFor,
  openTestHub,
  type TestHub,
} from "@/test/hub";
import { importClient, importProject, importProjectPlan } from "./import";

const S = "proj_hub_gestao";
let h: TestHub;
let importer: AgentActor;
let kratos: AgentActor;
const asImporter = () => ctxFor(h, importer, "mcp");
const asOwner = () => ctxFor(h, h.owner_actor, "ui");

const PLAN = `# Plano da Ótica

## ✅ M1 — Diagnóstico

### Levantamento
- [x] Entrevistar a dona da ótica — evidência: ata de 02/10
- [x] Mapear os atendimentos

## M2 — Agente de vendas no WhatsApp

### Conversa
- [ ] Escrever o roteiro de vendas
  - [ ] Versão para armações
- [ ] Testar com clientes reais

### 🔒 GATE M2 (aprovação do Fábio)
- [ ] O agente fecha uma venda sozinho
`;

beforeAll(async () => {
  h = await openTestHub();
  // A chave "todos" (todos os projetos, workspace:*) faz o papel do importador.
  importer = await agentActor(h, h.keys.todos);
  kratos = await agentActor(h, h.keys.kratos);
});

afterAll(async () => {
  await h.db.close();
});

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err instanceof HubError ? err.status : 500;
  }
};

describe("importação de projetos por agente (D10)", () => {
  it("cliente: cadastra sem portal e repetir devolve o mesmo", async () => {
    const first = await inTx(asImporter(), (t) =>
      importClient(t, { name: "Ótica Visão Clara", segment: "Ótica" }),
    );
    expect(first).toMatchObject({
      created: true,
      client: { name: "Ótica Visão Clara", slug: "otica-visao-clara" },
    });
    const again = await inTx(asImporter(), (t) =>
      importClient(t, { name: "ótica visão clara" }),
    );
    expect(again).toMatchObject({
      created: false,
      client: { id: first.client.id },
    });
    const portal = await h.raw.query<{ portal_enabled: boolean }>(
      `select portal_enabled from ${S}.clients where id = $1`,
      [first.client.id],
    );
    expect(portal.rows[0].portal_enabled).toBe(false);
    // Sem o escopo projects:import, recusa.
    expect(
      await status(
        inTx(ctxFor(h, kratos, "mcp"), (t) =>
          importClient(t, { name: "Outro cliente" }),
        ),
      ),
    ).toBe(403);
  });

  it("projeto: nasce Em revisão, repetir devolve o mesmo e código do Hub é recusado", async () => {
    const made = await inTx(asImporter(), (t) =>
      importProject(t, {
        client: "otica-visao-clara",
        code: "OTI",
        name: "Agente de vendas da ótica",
        departments: ["agentes-e-automacoes"],
        repo_url: "https://github.com/Harmony-Digital/otica",
        plan_path: "PLAN.md",
      }),
    );
    expect(made).toMatchObject({
      created: true,
      project: {
        code: "OTI",
        status: "in_review",
        client: { name: "Ótica Visão Clara" },
        departments: [{ slug: "agentes-e-automacoes" }],
      },
    });
    expect(
      await inTx(asImporter(), (t) =>
        importProject(t, {
          client: "Ótica Visão Clara",
          code: "OTI",
          name: "Agente de vendas da ótica",
        }),
      ),
    ).toMatchObject({ created: false, project: { code: "OTI" } });
    expect(
      await status(
        inTx(asImporter(), (t) =>
          importProject(t, {
            client: "otica-visao-clara",
            code: "VIT",
            name: "x",
          }),
        ),
      ),
    ).toBe(409);
    expect(
      await status(
        inTx(asImporter(), (t) =>
          importProject(t, {
            client: "otica-visao-clara",
            code: "OT2",
            name: "x",
            departments: ["nao-existe"],
          }),
        ),
      ),
    ).toBe(422);
    expect(
      await status(
        inTx(asImporter(), (t) =>
          importProject(t, { client: "ninguem", code: "OT3", name: "x" }),
        ),
      ),
    ).toBe(422);
  });

  it("plano: prévia sem gravar, depois marcos Planejados, tarefas e o pedido de revisão (um só)", async () => {
    const tasks = () =>
      count(
        h,
        `select count(*)::int as n from ${S}.tasks t join ${S}.projects p on p.id = t.project_id where p.code = 'OTI'`,
      );
    const preview = await inTx(asImporter(), (t) =>
      importProjectPlan(t, { project: "OTI", markdown: PLAN, dry_run: true }),
    );
    expect(preview).toMatchObject({
      dry_run: true,
      approval: null,
      summary: { milestones_created: 2, created: 5 },
    });
    expect(await tasks()).toBe(0);

    const result = await inTx(asImporter(), (t) =>
      importProjectPlan(t, {
        project: "OTI",
        markdown: PLAN,
        summary: "Plano do repositório da ótica, sem os anexos de preço.",
        next_status: "active",
      }),
    );
    expect(result).toMatchObject({
      dry_run: false,
      approval: { created: true },
      summary: { milestones_created: 2, created: 5, completed: 2 },
    });
    expect(await tasks()).toBe(5);
    // Marcos sempre Planejados (o andamento é marcado por pessoa), com o código do arquivo.
    const milestones = await h.raw.query<{ code: string; status: string }>(
      `select m.code, m.status::text as status from ${S}.milestones m
         join ${S}.projects p on p.id = m.project_id where p.code = 'OTI' order by m.code`,
    );
    expect(milestones.rows).toEqual([
      { code: "M1", status: "planned" },
      { code: "M2", status: "planned" },
    ]);
    const approval = await h.raw.query<{
      type: string;
      status: string;
      title: string;
      summary: string;
      requested_by_type: string;
    }>(
      `select type::text as type, status::text as status, title, summary,
              requested_by_type::text as requested_by_type
         from ${S}.approvals where id = $1`,
      [result.approval!.id],
    );
    expect(approval.rows[0]).toMatchObject({
      type: "import_review",
      status: "pending",
      title: "Revisar a importação de OTI · Agente de vendas da ótica",
      requested_by_type: "agent",
    });
    expect(approval.rows[0].summary).toContain(
      "Plano do repositório da ótica, sem os anexos de preço.",
    );
    expect(approval.rows[0].summary).toContain(
      "Importado do plan.md: 2 marco(s), 2 frente(s) e 5 tarefa(s), 2 já concluída(s).",
    );

    // Importar de novo o arquivo devolvido (com os códigos) não cria nada nem outro pedido.
    const again = await inTx(asImporter(), (t) =>
      importProjectPlan(t, { project: "OTI", markdown: result.markdown }),
    );
    expect(again).toMatchObject({
      approval: { id: result.approval!.id, created: false },
      summary: { milestones_created: 0, created: 0 },
    });
    expect(await tasks()).toBe(5);
  });

  it("projeto fora de revisão não recebe importação por agente", async () => {
    expect(
      await status(
        inTx(asImporter(), (t) =>
          importProjectPlan(t, { project: "VIT", markdown: PLAN }),
        ),
      ),
    ).toBe(422);
  });

  it("o dono aprova em lote só importações; aprovar ativa o projeto", async () => {
    await inTx(asImporter(), (t) =>
      importProject(t, {
        client: "otica-visao-clara",
        code: "OT4",
        name: "Segundo projeto da ótica",
      }),
    );
    const second = await inTx(asImporter(), (t) =>
      importProjectPlan(t, {
        project: "OT4",
        markdown: "# Plano\n\n## M1 — Começo\n\n### Frente\n- [ ] Tarefa\n",
        next_status: "discovery",
      }),
    );
    const first = (
      await h.raw.query<{ id: string }>(
        `select a.id from ${S}.approvals a join ${S}.projects p on p.id = a.project_id
          where p.code = 'OTI' and a.type = 'import_review'`,
      )
    ).rows[0].id;
    const other = await inTx(
      ctxFor(h, { ...kratos, actingRole: "GP-01" }, "mcp"),
      (t) =>
        requestApproval(t, {
          type: "replan",
          project: "VIT",
          title: "Mover a entrega",
          payload: { milestones: [{ code: "M1", due_date: "2026-12-01" }] },
        }),
    );
    // Agente não aprova (nem em lote).
    expect(
      await status(
        inTx(asImporter(), (t) => approveImportsInBatch(t, [first])),
      ),
    ).toBe(403);
    const batch = await inTx(asOwner(), (t) =>
      approveImportsInBatch(t, [first, second.approval!.id, other.id]),
    );
    expect(batch.approved.map((a) => a.project_code).sort()).toEqual([
      "OT4",
      "OTI",
    ]);
    expect(batch.failed).toEqual([
      { id: other.id, message: "Não é um pedido de importação de projeto." },
    ]);
    const statuses = await h.raw.query<{ code: string; status: string }>(
      `select code, status::text as status from ${S}.projects where code in ('OTI', 'OT4') order by code`,
    );
    expect(statuses.rows).toEqual([
      { code: "OT4", status: "discovery" },
      { code: "OTI", status: "active" },
    ]);
    // O pedido que não era de importação continua esperando decisão.
    expect(
      await inTx(asOwner(), (t) =>
        decideApproval(t, other.id, {
          decision: "rejected",
          note: "Não agora.",
        }),
      ),
    ).toMatchObject({ status: "rejected" });
  });
});
