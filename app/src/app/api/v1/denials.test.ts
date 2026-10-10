import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDbForTests } from "@/lib/db";
import { openTestHub, TEST_PEPPER, type TestHub } from "@/test/hub";
import { POST as mcpPost } from "../../mcp/route";
import { GET as getMe } from "./me/route";
import { POST as createTaskRoute } from "./tasks/route";

const S = "proj_hub_gestao";
let h: TestHub;
let client: Client | null = null;

beforeAll(async () => {
  process.env.HUB_API_KEY_PEPPER = TEST_PEPPER;
  h = await openTestHub();
  setDbForTests(h.db);
});
afterAll(async () => {
  await client?.close().catch(() => undefined);
  setDbForTests(null);
  await h.db.close();
});

async function denials() {
  return (
    await h.raw.query<{
      agent: string | null;
      source: string;
      status: number;
      action: string;
      key_prefix: string | null;
    }>(
      `select a.name as agent, d.source, d.status::int as status, d.action, d.key_prefix
         from ${S}.agent_denials d left join ${S}.agents a on a.id = d.agent_id
        order by d.id`,
    )
  ).rows;
}

function api(path: string, key: string, init: RequestInit = {}) {
  return new Request(`http://hub.test/api/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, ...init.headers },
  });
}

describe("recusas de acesso registradas para a Sala de Controle", () => {
  it("API: sem permissão (403) e agente pausado (423) entram; chave desconhecida, não", async () => {
    const denied = await createTaskRoute(
      api("/tasks", h.keys.leitor, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "recusa-api-0001",
        },
        body: JSON.stringify({ project: "VIT", title: "Sem permissão" }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(denied.status).toBe(403);
    expect((await getMe(api("/me", h.keys.pausado))).status).toBe(423);
    expect(
      (
        await getMe(
          api("/me", "hub_ak_naoexiste12.segredo-que-nao-existe-no-banco-0000"),
        )
      ).status,
    ).toBe(401);

    const rows = await denials();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      agent: "Executor",
      source: "api",
      status: 403,
      action: "POST /api/v1/tasks",
    });
    expect(rows[0].key_prefix).toMatch(/^hub_ak_/);
    expect(rows[1]).toMatchObject({
      agent: "Pausado",
      source: "api",
      status: 423,
      action: "GET /api/v1/me",
    });
  });

  it("MCP: ferramenta recusada entra com o nome dela", async () => {
    client = new Client({ name: "teste-recusas", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://hub.test/mcp"), {
        fetch: async (input, init) => mcpPost(new Request(input, init)),
        requestInit: { headers: { Authorization: `Bearer ${h.keys.kratos}` } },
      }),
    );
    // A chave do Kratos vale só para o VIT.
    const result = (await client.callTool({
      name: "hub_get_project",
      arguments: { project: "HUB" },
    })) as { isError?: boolean };
    expect(result.isError).toBe(true);

    const rows = await denials();
    expect(rows.at(-1)).toMatchObject({
      agent: "Kratos",
      source: "mcp",
      status: 403,
      action: "hub_get_project",
    });
  });
});
