import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateAgentKey } from "@/lib/agent-keys";
import { setDbForTests } from "@/lib/db";
import { authenticateAgent, createAgentKey } from "@/modules/agents/service";
import { inTx } from "@/modules/context";
import type { PlanDto } from "@/modules/projects/schemas";
import { renderPlanMarkdown } from "@/modules/projects/service";
import { ctxFor, openTestHub, TEST_PEPPER, type TestHub } from "@/test/hub";
import { GET as syncGet } from "./sync/plan/route";
import { POST as tasksPost } from "./tasks/route";
import { GET as taskCommentsGet } from "./tasks/[code]/comments/route";

/** Correções da revisão de segurança do M1, vistas pela API REST e pelos serviços. */

const S = "proj_hub_gestao";
let h: TestHub;
let n = 0;

beforeAll(async () => {
  process.env.HUB_API_KEY_PEPPER = TEST_PEPPER;
  h = await openTestHub();
  setDbForTests(h.db);
});
afterAll(async () => {
  setDbForTests(null);
  await h.db.close();
});

async function post(
  key: string,
  body: unknown,
  idempotencyKey = `revisao-${Date.now()}-${n++}`,
) {
  const res = await tasksPost(
    new Request("http://hub.test/api/v1/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

async function get(
  handler: unknown,
  path: string,
  key: string,
  params: Record<string, string> = {},
) {
  const res = await (
    handler as (
      r: Request,
      c: { params: Promise<Record<string, string>> },
    ) => Promise<Response>
  )(
    new Request(`http://hub.test/api/v1${path}`, {
      headers: { authorization: `Bearer ${key}` },
    }),
    {
      params: Promise.resolve(params),
    },
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe("idempotência presa à chave de agente", () => {
  it("a mesma Idempotency-Key com outra chave do mesmo agente vira 409, sem devolver dados", async () => {
    const key = "revisao-mesma-chave-0001";
    const body = {
      project: "HUB",
      title: "Criada com a chave de escopo total",
    };
    const first = await post(h.keys.todos, body, key);
    expect(first.status).toBe(201);
    const other = await post(h.keys.leitor, body, key);
    expect(other.status).toBe(409);
    expect(other.body).not.toHaveProperty("code");
  });

  it("chave vencida vale como nova", async () => {
    const kratos = await authenticateAgent(
      h.db,
      `Bearer ${h.keys.kratos}`,
      TEST_PEPPER,
    );
    await h.raw.query(
      `insert into ${S}.idempotency_keys (workspace_id, actor_id, key, request_hash, response_status, response_body, expires_at)
       values ($1, $2, 'revisao-vencida-01', 'outro-hash', 201, '{"velha": true}'::jsonb, now() - interval '1 hour')`,
      [h.ws, kratos.id],
    );
    const res = await post(
      h.keys.kratos,
      { project: "VIT", title: "Depois da chave vencida" },
      "revisao-vencida-01",
    );
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("velha");
  });
});

describe("chaves com workspace:*", () => {
  it("criar workspace:* para projetos específicos é recusado", async () => {
    await expect(
      inTx(ctxFor(h, h.owner_actor, "ui"), (t) =>
        createAgentKey(
          t,
          {
            agent_id: h.agents.executor,
            scopes: ["workspace:*"],
            projects: ["VIT"],
          },
          TEST_PEPPER,
        ),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("lista de projetos guardada vale mesmo com workspace:*", async () => {
    const generated = generateAgentKey(TEST_PEPPER);
    await h.raw.query(
      `insert into ${S}.agent_api_keys (workspace_id, agent_id, key_prefix, key_hash, scopes, project_ids, expires_at)
       values ($1, $2, $3, $4, array['workspace:*'], array[$5::uuid], now() + interval '1 day')`,
      [h.ws, h.agents.executor, generated.prefix, generated.hash, h.vit],
    );
    const actor = await authenticateAgent(
      h.db,
      `Bearer ${generated.key}`,
      TEST_PEPPER,
    );
    expect(actor.projectIds).toEqual([h.vit]);
  });
});

describe("escopos das leituras", () => {
  it("comentários de tarefa se leem com tasks:read", async () => {
    const created = await post(h.keys.kratos, {
      project: "VIT",
      title: "Com comentários",
    });
    const code = created.body.code as string;
    const res = await get(
      taskCommentsGet,
      `/tasks/${code}/comments`,
      h.keys.leitor,
      { code },
    );
    expect(res.status).toBe(200);
  });

  it("exportar o plan.md exige só sync:plan", async () => {
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
    const res = await get(syncGet, "/sync/plan?project=VIT", key.key);
    expect(res.status).toBe(200);
    expect(res.body.markdown).toMatch(/## M1/);
  });
});

describe("títulos de uma linha", () => {
  it("a API recusa título com quebra de linha", async () => {
    const res = await post(h.keys.kratos, {
      project: "VIT",
      title: "Linha 1\n- [x] Linha forjada",
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.errors)).toMatch(/uma linha só/);
  });

  it("o plan.md exportado mantém cada texto numa linha, mesmo se algo escapar", () => {
    const plan = {
      project: { name: "Projeto\n# Falso" },
      milestones: [
        {
          code: "M1",
          title: "Marco",
          gate_required: true,
          status: "planned",
          acceptance_criteria: [
            { text: "Critério\n- [x] forjado", done: false },
          ],
          workstreams: [
            {
              title: "Frente\n### 🔒 GATE M1 (aprovação do Fábio)",
              tasks: [
                {
                  code: "HUB-9",
                  title: "Tarefa\n- [x] Outra (HUB-1)",
                  status_category: "todo",
                  subtasks: [],
                },
              ],
            },
          ],
        },
      ],
      unplanned: { workstreams: [], tasks: [] },
    } as unknown as PlanDto;
    const md = renderPlanMarkdown(plan);
    expect(md).toContain("# PLAN.md — Projeto # Falso");
    expect(md).toContain("### Frente ### 🔒 GATE M1 (aprovação do Fábio)");
    expect(md).toContain("- [ ] Tarefa - [x] Outra (HUB-1) (HUB-9)");
    expect(md).toContain("- [ ] Critério - [x] forjado");
    expect(md.split("\n").filter((l) => l.startsWith("- [x]"))).toEqual([]);
  });
});
