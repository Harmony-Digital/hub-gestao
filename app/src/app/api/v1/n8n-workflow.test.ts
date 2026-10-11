import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setDbForTests } from "@/lib/db";

// connection() do Next só existe dentro de um pedido real; aqui a rota roda direto.
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => undefined,
}));
import { createAgent, createAgentKey } from "@/modules/agents/service";
import { inTx } from "@/modules/context";
import { count, openTestHub, TEST_PEPPER, type TestHub } from "@/test/hub";
import { GET as tasksGet, POST as tasksPost } from "./tasks/route";

/**
 * O fluxo do n8n do N8-17 (`agents/n8n/hub-nova-tarefa.json`): o pedido que ele monta vai
 * para a rota de verdade, com uma chave de integração de escopo mínimo (`tasks:write`
 * num projeto só). Se o contrato da API mudar, este teste acusa antes de o fluxo
 * quebrar no n8n.
 */

type N8nNode = {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
};
type Workflow = {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: { node: string }[][] }>;
};

const FILE = path.resolve(
  import.meta.dirname,
  "../../../../../agents/n8n/hub-nova-tarefa.json",
);
const text = readFileSync(FILE, "utf8");
const workflow = JSON.parse(text) as Workflow;
const node = (name: string) => {
  const found = workflow.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`O fluxo não tem o nó "${name}".`);
  return found;
};
const request = node("Criar a tarefa no Hub");
const params = request.parameters as {
  method: string;
  url: string;
  headerParameters: { parameters: { name: string; value: string }[] };
  jsonBody: string;
};

type Scope = {
  $json: Record<string, unknown>;
  $execution: { id: string };
  $itemIndex: number;
};

/**
 * Avalia uma expressão do n8n (`={{ ... }}`). As do fluxo usam só JavaScript comum, de
 * propósito: assim o teste roda a mesma conta que o n8n faz.
 */
function evaluate(value: string, scope: Scope): unknown {
  const match = /^=\{\{([\s\S]*)\}\}$/.exec(value.trim());
  if (!match) return value;
  const run = new Function(
    "$json",
    "$execution",
    "$itemIndex",
    `return (${match[1]});`,
  ) as (...args: unknown[]) => unknown;
  return run(scope.$json, scope.$execution, scope.$itemIndex);
}

const example = JSON.parse(
  (node("Exemplo").parameters as { jsonOutput: string }).jsonOutput,
) as Record<string, unknown>;

let h: TestHub;
let key: string;

beforeAll(async () => {
  process.env.HUB_API_KEY_PEPPER = TEST_PEPPER;
  h = await openTestHub();
  setDbForTests(h.db);
  const ctx = {
    db: h.db,
    actor: h.owner_actor,
    source: "ui" as const,
    requestId: "teste-n8n",
  };
  key = await inTx(ctx, async (t) => {
    const agent = await createAgent(t, {
      name: "n8n Bridge",
      kind: "integration",
    });
    return (
      await createAgentKey(
        t,
        { agent_id: agent.id, scopes: ["tasks:write"], projects: ["VIT"] },
        TEST_PEPPER,
      )
    ).key;
  });
});
afterAll(async () => {
  setDbForTests(null);
  await h.db.close();
});

/** Manda o pedido do nó HTTP do fluxo, com o item que chega a ele. */
async function send(item: Record<string, unknown>, executionId = "501") {
  const scope = { $json: item, $execution: { id: executionId }, $itemIndex: 0 };
  const headers: Record<string, string> = {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
  for (const header of params.headerParameters.parameters) {
    headers[header.name.toLowerCase()] = String(evaluate(header.value, scope));
  }
  const res = await tasksPost(
    new Request(
      params.url.replace(
        "https://hub.harmonydigital.com.br",
        "http://hub.test",
      ),
      {
        method: params.method,
        headers,
        body: String(evaluate(params.jsonBody, scope)),
      },
    ),
    { params: Promise.resolve({}) },
  );
  return {
    status: res.status,
    replayed: res.headers.get("idempotent-replayed"),
    key: headers["idempotency-key"],
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe("fluxo do n8n (N8-17)", () => {
  it("liga os dois gatilhos ao pedido e não carrega segredo", () => {
    expect(
      workflow.connections["Quando outro fluxo chamar"].main[0][0].node,
    ).toBe("Criar a tarefa no Hub");
    expect(workflow.connections["Testar com um exemplo"].main[0][0].node).toBe(
      "Exemplo",
    );
    expect(workflow.connections["Exemplo"].main[0][0].node).toBe(
      "Criar a tarefa no Hub",
    );
    expect(params.method).toBe("POST");
    expect(params.url).toBe("https://hub.harmonydigital.com.br/api/v1/tasks");
    // A chave fica na credencial do n8n, escolhida na tela; o arquivo só leva o nome.
    expect(request.credentials).toEqual({
      httpHeaderAuth: { id: "", name: "Hub de Gestão (N8-17)" },
    });
    expect(
      params.headerParameters.parameters.map((p) => p.name.toLowerCase()),
    ).not.toContain("authorization");
    expect(text).not.toMatch(/hub_ak_|Bearer\s+\S{8,}/);
  });

  it("o exemplo cria a tarefa com a chave de escopo mínimo, sem duplicar", async () => {
    const item = { ...example, projeto: "VIT" };
    const first = await send(item);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      title: example.titulo,
      priority: "normal",
      external_ref: "teste-n8n-1",
    });
    expect(first.key).toBe("n8n-tarefa-teste-n8n-1");

    // Rodar de novo (outra execução, mesmo id_externo) devolve a mesma tarefa.
    const again = await send(item, "502");
    expect(again.replayed).toBe("true");
    expect(again.body.code).toBe(first.body.code);
    expect(
      await count(
        h,
        `select count(*)::int as n from proj_hub_gestao.tasks where external_ref = 'teste-n8n-1'`,
      ),
    ).toBe(1);

    // O mesmo id_externo com outros dados é recusado: o Hub não cria a tarefa repetida.
    expect((await send({ ...item, titulo: "Outro título" })).status).toBe(409);
  });

  it("id externo com caracteres soltos e item sem id viram chaves válidas", async () => {
    const lead = await send({
      projeto: "VIT",
      titulo: "Lead qualificado: Clínica Modelo",
      id_externo: "lead 42@site",
    });
    expect(lead.status).toBe(201);
    expect(lead.key).toBe("n8n-tarefa-lead-42-site");

    const semId = await send(
      { projeto: "VIT", titulo: "Chamado sem id" },
      "777",
    );
    expect(semId.status).toBe(201);
    expect(semId.key).toBe("n8n-tarefa-777-0");
    expect(semId.body.external_ref).toBeNull();
  });

  it("a chave do fluxo não lê tarefas nem escreve fora do projeto dela", async () => {
    const read = await tasksGet(
      new Request("http://hub.test/api/v1/tasks?project=VIT", {
        headers: { authorization: `Bearer ${key}` },
      }),
      { params: Promise.resolve({}) },
    );
    expect(read.status).toBe(403);
    const outside = await send({ projeto: "HUB", titulo: "Fora do alcance" });
    expect(outside.status).toBe(403);
  });
});
