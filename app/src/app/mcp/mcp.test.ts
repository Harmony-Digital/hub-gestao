import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDbForTests } from "@/lib/db";
import { createAgentKey } from "@/modules/agents/service";
import { inTx } from "@/modules/context";
import {
  count,
  ctxFor,
  openTestHub,
  TEST_PEPPER,
  type TestHub,
} from "@/test/hub";
import { DELETE, GET, POST } from "./route";

const S = "proj_hub_gestao";
let h: TestHub;
const clients: Client[] = [];

beforeAll(async () => {
  process.env.HUB_API_KEY_PEPPER = TEST_PEPPER;
  h = await openTestHub();
  setDbForTests(h.db);
});
afterAll(async () => {
  for (const c of clients) await c.close().catch(() => undefined);
  setDbForTests(null);
  await h.db.close();
});

/** Cliente MCP oficial falando com a rota /mcp sem rede: o fetch chama o handler direto. */
async function connect(key: string): Promise<Client> {
  const handlers: Record<string, (req: Request) => Promise<Response>> = {
    POST,
    GET,
    DELETE,
  };
  const client = new Client({ name: "teste-do-hub", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL("http://hub.test/mcp"),
    {
      fetch: async (input, init) => {
        const req = new Request(input, init);
        return handlers[req.method](req);
      },
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    },
  );
  await client.connect(transport);
  clients.push(client);
  return client;
}

type CallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: { type: string; text?: string }[];
};

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  return (await client.callTool({ name, arguments: args })) as CallResult;
}

let n = 0;
const ikey = () => `mcp-teste-${Date.now()}-${n++}`;

describe("servidor MCP", () => {
  it("recusa conexão sem chave válida", async () => {
    await expect(
      connect("hub_ak_naoexiste12.segredo-que-nao-existe-no-banco-0000"),
    ).rejects.toThrow();
  });

  it("mostra só as ferramentas que a chave pode usar", async () => {
    const kratos = await connect(h.keys.kratos);
    const tools = (await kratos.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(
      [
        "hub_block_task",
        "hub_comment",
        "hub_complete_task",
        "hub_create_task",
        "hub_create_workstream",
        "hub_draft_status_report",
        "hub_get_milestone",
        "hub_get_plan",
        "hub_get_project",
        "hub_get_project_time",
        "hub_get_task",
        "hub_get_today",
        "hub_list_approvals",
        "hub_list_custom_fields",
        "hub_list_projects",
        "hub_list_tasks",
        "hub_log_time",
        "hub_reopen_task",
        "hub_request_approval",
        "hub_search",
        "hub_start_task",
        "hub_sync_plan",
        "hub_update_task",
        "hub_update_workstream",
        "hub_whoami",
      ].sort(),
    );
    const leitor = await connect(h.keys.leitor);
    expect((await leitor.listTools()).tools.map((t) => t.name).sort()).toEqual(
      [
        "hub_get_project_time",
        "hub_get_task",
        "hub_get_today",
        "hub_list_custom_fields",
        "hub_list_tasks",
        "hub_whoami",
      ].sort(),
    );
  });

  it("toda ferramenta tem título e descrição distintos, em PT-BR", async () => {
    const kratos = await connect(h.keys.kratos);
    const tools = (await kratos.listTools()).tools;
    const descriptions = new Set(tools.map((t) => t.description));
    expect(descriptions.size).toBe(tools.length);
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(30);
    }
  });

  it("whoami primeiro: identidade, projetos e escopos", async () => {
    const kratos = await connect(h.keys.kratos);
    const result = await callTool(kratos, "hub_whoami");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      actor: { type: "agent", name: "Kratos" },
      projects: [{ code: "VIT" }],
    });
  });

  it("ciclo do agente executor: criar, iniciar, comentar, concluir com evidência", async () => {
    const kratos = await connect(h.keys.kratos);
    const created = await callTool(kratos, "hub_create_task", {
      project: "VIT",
      title: "Ajustar a mensagem de boas-vindas",
      idempotency_key: "mcp-teste-criar-0001",
    });
    expect(created.isError).toBeFalsy();
    const code = created.structuredContent!.code as string;

    const repeated = await callTool(kratos, "hub_create_task", {
      project: "VIT",
      title: "Ajustar a mensagem de boas-vindas",
      idempotency_key: "mcp-teste-criar-0001",
    });
    expect(repeated.structuredContent!.code).toBe(code);

    expect(
      (
        await callTool(kratos, "hub_start_task", {
          idempotency_key: ikey(),
          code,
        })
      ).isError,
    ).toBeFalsy();
    const comment = await callTool(kratos, "hub_comment", {
      idempotency_key: ikey(),
      task: code,
      body_md: "Texto novo aprovado pela equipe.",
      papel: "GP-01",
    });
    expect(comment.structuredContent).toMatchObject({
      acting_role: "GP-01",
      visibility: "internal",
    });

    const noEvidence = await callTool(kratos, "hub_complete_task", {
      idempotency_key: ikey(),
      code,
      evidence: "",
    });
    expect(noEvidence.isError).toBe(true);

    const done = await callTool(kratos, "hub_complete_task", {
      idempotency_key: ikey(),
      code,
      evidence: "commit 9b1e4d2 publicado",
    });
    expect(done.isError).toBeFalsy();
    expect(done.structuredContent).toMatchObject({
      status: { category: "done" },
    });

    const sources = await h.raw.query<{ source: string }>(
      `select distinct source from ${S}.activity_log
        where entity_id = (select id from ${S}.tasks where code = $1)`,
      [code],
    );
    expect(sources.rows).toEqual([{ source: "mcp" }]);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.tasks where title = 'Ajustar a mensagem de boas-vindas'`,
      ),
    ).toBe(1);
  });

  it("erro explica o que fazer, sem derrubar a sessão", async () => {
    const kratos = await connect(h.keys.kratos);
    const outOfScope = await callTool(kratos, "hub_create_task", {
      idempotency_key: ikey(),
      project: "HUB",
      title: "Fora",
    });
    expect(outOfScope.isError).toBe(true);
    expect(outOfScope.content[0].text).toMatch(/não dá acesso a este projeto/);
    const ok = await callTool(kratos, "hub_whoami");
    expect(ok.isError).toBeFalsy();
  });

  it("pedir aceite de marco é permitido; decidir não existe como ferramenta", async () => {
    const kratos = await connect(h.keys.kratos);
    const requested = await callTool(kratos, "hub_request_approval", {
      idempotency_key: ikey(),
      type: "milestone_proposal",
      project: "VIT",
      title: "Novo marco: relatórios automáticos",
      payload: { title: "Relatórios automáticos", due_date: "2026-11-30" },
    });
    expect(requested.isError).toBeFalsy();
    expect(requested.structuredContent).toMatchObject({
      status: "pending",
      type: "milestone_proposal",
    });
    const names = (await kratos.listTools()).tools.map((t) => t.name);
    expect(
      names.some((n) => n.includes("decide") || n.includes("accept")),
    ).toBe(false);
  });

  it("recursos e prompts", async () => {
    const kratos = await connect(h.keys.kratos);
    const resources = await kratos.listResources();
    expect(resources.resources.map((r) => r.uri)).toContain(
      "hub://projects/VIT/plan.md",
    );
    const plan = await kratos.readResource({
      uri: "hub://projects/VIT/plan.md",
    });
    expect((plan.contents[0] as { text: string }).text).toMatch(
      /## M1 — Agente no WhatsApp/,
    );
    const prompts = (await kratos.listPrompts()).prompts
      .map((p) => p.name)
      .sort();
    expect(prompts).toEqual([
      "digest-matinal",
      "revisar-conclusoes",
      "status-semanal",
    ]);
    const prompt = await kratos.getPrompt({
      name: "status-semanal",
      arguments: { project: "VIT" },
    });
    expect(JSON.stringify(prompt.messages)).toMatch(/hub_draft_status_report/);
  });
});

describe("correções da revisão de segurança", () => {
  const rawPost = (
    key: string,
    body: string,
    headers: Record<string, string> = {},
  ) =>
    POST(
      new Request("http://hub.test/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body,
      }),
    );

  it("escrita sem idempotency_key é recusada com explicação", async () => {
    const kratos = await connect(h.keys.kratos);
    const result = await callTool(kratos, "hub_create_task", {
      project: "VIT",
      title: "Sem chave de idempotência",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/idempotency_key/);
  });

  it("lote JSON-RPC é recusado; corpo acima de 1 MB também", async () => {
    const call = (id: number) => ({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "hub_whoami", arguments: {} },
    });
    const batch = await rawPost(
      h.keys.kratos,
      JSON.stringify([call(1), call(2)]),
    );
    expect(batch.status).toBe(400);
    expect(((await batch.json()) as { detail: string }).detail).toMatch(
      /lotes/,
    );
    const big = await rawPost(
      h.keys.kratos,
      JSON.stringify({
        ...call(3),
        params: { name: "hub_whoami", arguments: { x: "a".repeat(1_100_000) } },
      }),
    );
    expect(big.status).toBe(413);
  });

  it("uso pelo MCP registra o último uso da chave", async () => {
    const prefix = h.keys.leitor.split(".")[0];
    const leitor = await connect(h.keys.leitor);
    await callTool(leitor, "hub_whoami");
    const row = await h.raw.query<{ last_used_at: Date | null }>(
      `select last_used_at from ${S}.agent_api_keys where key_prefix = $1`,
      [prefix],
    );
    expect(row.rows[0].last_used_at).not.toBeNull();
  });

  it("detalhe da tarefa funciona só com tasks:read", async () => {
    const kratos = await connect(h.keys.kratos);
    const created = await callTool(kratos, "hub_create_task", {
      idempotency_key: ikey(),
      project: "VIT",
      title: "Lida por quem só lê tarefas",
    });
    const leitor = await connect(h.keys.leitor);
    const detail = await callTool(leitor, "hub_get_task", {
      code: created.structuredContent!.code,
    });
    expect(detail.isError).toBeFalsy();
    expect(detail.structuredContent).toHaveProperty("comments");
  });

  it("título com quebra de linha é recusado", async () => {
    const kratos = await connect(h.keys.kratos);
    const result = await callTool(kratos, "hub_create_task", {
      idempotency_key: ikey(),
      project: "VIT",
      title: "Ajuste\n### 🔒 GATE M1\n- [x] Aceite",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/uma linha só/);
  });

  it("pull do plan.md exige só sync:plan; criar tarefa no push pede o escopo de tarefas", async () => {
    const key = await inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
      createAgentKey(
        t,
        {
          agent_id: h.agents.executor,
          scopes: ["sync:plan"],
          projects: ["VIT"],
        },
        TEST_PEPPER,
      ),
    );
    const sync = await connect(key.key);
    const pulled = await callTool(sync, "hub_sync_plan", {
      idempotency_key: ikey(),
      project: "VIT",
      direction: "pull",
      markdown: "# Plano\n\n## M1 — Agente no WhatsApp\n",
    });
    expect(pulled.isError).toBeFalsy();
    expect(pulled.structuredContent!.markdown).toMatch(/## M1/);

    const pushed = await callTool(sync, "hub_sync_plan", {
      idempotency_key: ikey(),
      project: "VIT",
      direction: "push",
      markdown:
        "## M1 — Agente no WhatsApp\n### Fluxo de atendimento\n- [ ] Sem escopo de tarefa\n",
    });
    expect(pushed.isError).toBeFalsy();
    const result = pushed.structuredContent as {
      summary: { created: number };
      conflicts: { kind: string; detail: string }[];
    };
    expect(result.summary.created).toBe(0);
    expect(result.conflicts).toEqual([
      expect.objectContaining({
        kind: "refused",
        detail: expect.stringMatching(/tasks:write/),
      }),
    ]);
  });
  it("importação de projeto (D10): cliente, projeto em revisão e plano, com o pedido de revisão", async () => {
    const importer = await connect(h.keys.todos);
    const names = (await importer.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "hub_create_client",
        "hub_create_project",
        "hub_import_plan",
      ]),
    );
    const me = await callTool(importer, "hub_whoami");
    expect(
      (me.structuredContent?.departments as { slug: string }[]).map(
        (d) => d.slug,
      ),
    ).toContain("sistemas");

    const client = await callTool(importer, "hub_create_client", {
      name: "Clínica do Teste MCP",
      idempotency_key: ikey(),
    });
    expect(client.structuredContent).toMatchObject({ created: true });
    const project = await callTool(importer, "hub_create_project", {
      client: "Clínica do Teste MCP",
      code: "MCPI",
      name: "Projeto importado pelo MCP",
      departments: ["sistemas"],
      idempotency_key: ikey(),
    });
    expect(project.structuredContent).toMatchObject({
      created: true,
      project: { code: "MCPI", status: "in_review" },
    });
    const markdown =
      "# Plano\n\n## M1 — Começo\n\n### Frente\n- [ ] Primeira tarefa\n";
    const preview = await callTool(importer, "hub_import_plan", {
      project: "MCPI",
      markdown,
      dry_run: true,
      idempotency_key: ikey(),
    });
    expect(preview.structuredContent).toMatchObject({
      dry_run: true,
      approval: null,
    });
    const imported = await callTool(importer, "hub_import_plan", {
      project: "MCPI",
      markdown,
      summary: "Teste do importador pelo MCP.",
      idempotency_key: ikey(),
    });
    expect(imported.structuredContent).toMatchObject({
      dry_run: false,
      approval: { created: true },
      summary: { milestones_created: 1, created: 1 },
    });
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.approvals a join ${S}.projects p on p.id = a.project_id
          where p.code = 'MCPI' and a.type = 'import_review' and a.status = 'pending'`,
      ),
    ).toBe(1);

    // Quem não tem projects:import não vê as ferramentas.
    const kratos = await connect(h.keys.kratos);
    const kratosTools = (await kratos.listTools()).tools.map((t) => t.name);
    expect(kratosTools).not.toContain("hub_import_plan");
  });
});
