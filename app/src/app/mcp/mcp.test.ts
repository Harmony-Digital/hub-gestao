import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDbForTests } from "@/lib/db";
import { count, openTestHub, TEST_PEPPER, type TestHub } from "@/test/hub";
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
        "hub_get_plan",
        "hub_get_project",
        "hub_get_task",
        "hub_get_today",
        "hub_list_approvals",
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
      ["hub_get_task", "hub_get_today", "hub_list_tasks", "hub_whoami"].sort(),
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
      (await callTool(kratos, "hub_start_task", { code })).isError,
    ).toBeFalsy();
    const comment = await callTool(kratos, "hub_comment", {
      task: code,
      body_md: "Texto novo aprovado pela equipe.",
      papel: "GP-01",
    });
    expect(comment.structuredContent).toMatchObject({
      acting_role: "GP-01",
      visibility: "internal",
    });

    const noEvidence = await callTool(kratos, "hub_complete_task", {
      code,
      evidence: "",
    });
    expect(noEvidence.isError).toBe(true);

    const done = await callTool(kratos, "hub_complete_task", {
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
