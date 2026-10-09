import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentActor } from "@/lib/db/actor";
import { AGENT_SCOPES } from "@/lib/agent-keys";
import { buildMcpServer } from "@/modules/mcp/server";
import { API_SPECS, buildOpenApi } from "./contract";

const API_DIR = path.resolve(import.meta.dirname, "../../app/api/v1");
const DOCS = path.resolve(import.meta.dirname, "../../../../docs");

/** Rotas reais: cada route.ts em src/app/api/v1 e os métodos que ele exporta. */
async function routesInCode(): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name === "route.ts") {
        const source = await readFile(full, "utf8");
        const route =
          "/" +
          path
            .relative(API_DIR, path.dirname(full))
            .split(path.sep)
            .map((s) => s.replace(/^\[(.+)\]$/, "{$1}"))
            .join("/");
        if (route === "/openapi.json") continue;
        for (const m of source.matchAll(
          /export const (GET|POST|PATCH|PUT|DELETE)\b/g,
        )) {
          found.push(`${m[1].toLowerCase()} ${route}`);
        }
      }
    }
  }
  await walk(API_DIR);
  return found.sort();
}

describe("contrato da API v1", () => {
  it("toda rota do código está no contrato, e todo item do contrato existe no código", async () => {
    const inSpec = API_SPECS.map((s) => `${s.method} ${s.path}`).sort();
    expect(await routesInCode()).toEqual(inSpec);
  });

  it("o OpenAPI gerado é o mesmo versionado em docs/api/openapi.v1.json", async () => {
    const doc = buildOpenApi("1.0.0");
    await expect(JSON.stringify(doc, null, 2) + "\n").toMatchFileSnapshot(
      path.join(DOCS, "api/openapi.v1.json"),
    );
  });

  it("todo esquema referenciado existe", () => {
    const doc = buildOpenApi("1.0.0") as {
      components: { schemas: Record<string, unknown> };
    };
    const text = JSON.stringify(doc);
    const refs = [
      ...text.matchAll(/"#\/components\/schemas\/([A-Za-z0-9_]+)"/g),
    ].map((m) => m[1]);
    for (const ref of new Set(refs)) {
      expect(doc.components.schemas, `esquema ${ref}`).toHaveProperty(ref);
    }
  });
});

describe("contrato do MCP", () => {
  it("a lista de ferramentas (chave com todos os escopos de agente) é a versionada em docs/mcp/tools.v1.json", async () => {
    const actor: AgentActor = {
      type: "agent",
      id: "00000000-0000-4000-8000-000000000001",
      scope: "internal",
      keyId: "00000000-0000-4000-8000-000000000002",
      kind: "hermes",
      scopes: AGENT_SCOPES.filter((s) => s !== "workspace:*"),
      projectIds: [],
      roles: [],
      workspaceId: "00000000-0000-4000-8000-000000000003",
      name: "Contrato",
    };
    const server = buildMcpServer(
      { db: undefined as never, actor, source: "mcp", requestId: "contrato" },
      "1.0.0",
    );
    const registered = (
      server as unknown as {
        _registeredTools: Record<
          string,
          { title?: string; description?: string; annotations?: unknown }
        >;
      }
    )._registeredTools;
    const tools = Object.entries(registered)
      .map(([name, t]) => ({
        name,
        title: t.title,
        description: t.description,
        annotations: t.annotations,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    await expect(JSON.stringify(tools, null, 2) + "\n").toMatchFileSnapshot(
      path.join(DOCS, "mcp/tools.v1.json"),
    );
  });
});
