import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setDbForTests } from "@/lib/db";

// connection() do Next só existe dentro de um pedido real; aqui a rota roda direto.
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  connection: async () => undefined,
}));
import { openTestHub, TEST_PEPPER, type TestHub } from "@/test/hub";
import { GET as approvalsList } from "./approvals/route";
import { POST as approvalsCreate } from "./approvals/route";
import { GET as approvalGet } from "./approvals/[id]/route";
import { GET as commentsGet, POST as commentsPost } from "./comments/route";
import { GET as milestoneGet } from "./milestones/[id]/route";
import { GET as openapiGet } from "./openapi.json/route";
import { GET as healthGet } from "./projects/[code]/health/route";
import { GET as milestonesGet } from "./projects/[code]/milestones/route";
import {
  GET as workstreamsGet,
  POST as workstreamsPost,
} from "./projects/[code]/workstreams/route";
import { GET as reportsGet, POST as reportsPost } from "./reports/route";
import { GET as syncGet } from "./sync/plan/route";
import { POST as tasksPost } from "./tasks/route";
import { POST as blockPost } from "./tasks/[code]/block/route";
import { GET as taskCommentsGet } from "./tasks/[code]/comments/route";
import { POST as reopenPost } from "./tasks/[code]/reopen/route";
import { POST as timePost } from "./tasks/[code]/time/route";
import {
  GET as workstreamGet,
  PATCH as workstreamPatch,
} from "./workstreams/[id]/route";

/**
 * Cobre as rotas da API v1 que o api.test.ts não exercita, para que toda rota tenha
 * teste de integração com o banco (PLAN M1, API REST v1).
 */

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

type AnyHandler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

async function call(
  handler: unknown,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
    key?: string | null;
  } = {},
) {
  const headers: Record<string, string> = {};
  const key = options.key === undefined ? h.keys.kratos : options.key;
  if (key) headers.authorization = `Bearer ${key}`;
  const method = options.method ?? "GET";
  if (method !== "GET") {
    headers["idempotency-key"] = `teste-rotas-${Date.now()}-${n++}`;
    headers["content-type"] = "application/json";
  }
  const res = await (handler as AnyHandler)(
    new Request(`http://hub.test/api/v1${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
    }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe("demais rotas da API v1", () => {
  it("saúde e marcos do projeto; detalhe do marco", async () => {
    const health = await call(healthGet, "/projects/VIT/health", {
      params: { code: "VIT" },
    });
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      project_code: "VIT",
      health: "healthy",
    });

    const milestones = await call(milestonesGet, "/projects/VIT/milestones", {
      params: { code: "VIT" },
    });
    expect((milestones.body.items as { code: string }[])[0].code).toBe("M1");

    const one = await call(milestoneGet, `/milestones/${h.vitMilestone}`, {
      params: { id: h.vitMilestone },
    });
    expect(one.body).toMatchObject({
      code: "M1",
      gate_required: true,
      late: false,
    });
    const bad = await call(milestoneGet, "/milestones/nao-e-uuid", {
      params: { id: "nao-e-uuid" },
    });
    expect(bad.status).toBe(400);
  });

  it("frentes: listar, criar (sempre interna), ler e atualizar", async () => {
    const created = await call(workstreamsPost, "/projects/VIT/workstreams", {
      method: "POST",
      params: { code: "VIT" },
      body: {
        title: "Treinamento da equipe",
        milestone: "M1",
        department: "sucesso-do-cliente",
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      visibility: "internal",
      milestone: { code: "M1" },
      department: { slug: "sucesso-do-cliente" },
    });
    const id = created.body.id as string;

    const clientText = await call(
      workstreamsPost,
      "/projects/VIT/workstreams",
      {
        method: "POST",
        params: { code: "VIT" },
        body: { title: "Tentativa", title_client: "Texto para o cliente" },
      },
    );
    expect(clientText.status).toBe(400);

    const list = await call(workstreamsGet, "/projects/VIT/workstreams", {
      params: { code: "VIT" },
    });
    expect((list.body.items as { id: string }[]).some((w) => w.id === id)).toBe(
      true,
    );

    const patched = await call(workstreamPatch, `/workstreams/${id}`, {
      method: "PATCH",
      params: { id },
      body: { status: "in_progress", department: "nao-existe" },
    });
    expect(patched.status).toBe(422);
    expect(patched.body.detail).toMatch(/Opções/);

    const ok = await call(workstreamPatch, `/workstreams/${id}`, {
      method: "PATCH",
      params: { id },
      body: { status: "in_progress" },
    });
    expect(ok.body).toMatchObject({ status: "in_progress" });
    const read = await call(workstreamGet, `/workstreams/${id}`, {
      params: { id },
    });
    expect(read.body).toMatchObject({ id, status: "in_progress" });
  });

  it("tarefa: bloquear, reabrir, registrar tempo e ler comentários", async () => {
    const task = await call(tasksPost, "/tasks", {
      method: "POST",
      body: { project: "VIT", title: "Conectar a agenda" },
    });
    const code = task.body.code as string;
    const blocked = await call(blockPost, `/tasks/${code}/block`, {
      method: "POST",
      params: { code },
      body: {
        reason: "Falta a credencial da agenda, que o cliente vai enviar.",
      },
    });
    expect(blocked.body).toMatchObject({ status: { category: "blocked" } });
    const reopened = await call(reopenPost, `/tasks/${code}/reopen`, {
      method: "POST",
      params: { code },
      body: { reason: "Credencial chegou." },
    });
    expect(reopened.body).toMatchObject({
      status: { category: "todo" },
      blocked_reason: null,
    });

    const time = await call(timePost, `/tasks/${code}/time`, {
      method: "POST",
      params: { code },
      body: { minutes: 45, note: "Configuração inicial" },
    });
    expect(time.status).toBe(201);
    expect(time.body).toMatchObject({ task_code: code, minutes: 45 });

    const comments = await call(taskCommentsGet, `/tasks/${code}/comments`, {
      params: { code },
    });
    expect((comments.body.items as { body_md: string }[])[0].body_md).toBe(
      "Reaberta: Credencial chegou.",
    );
  });

  it("comentário em projeto e em frente, pela rota geral", async () => {
    const onProject = await call(commentsPost, "/comments", {
      method: "POST",
      body: {
        target: { project: "VIT" },
        body_md: "Reunião de alinhamento feita.",
      },
    });
    expect(onProject.status).toBe(201);
    expect(onProject.body).toMatchObject({
      entity_type: "project",
      visibility: "internal",
    });
    const list = await call(commentsGet, "/comments?project=VIT");
    expect((list.body.items as unknown[]).length).toBeGreaterThanOrEqual(1);
    const two = await call(commentsGet, "/comments?project=VIT&task=HUB-1");
    expect(two.status).toBe(400);
  });

  it("aprovações: listar e ler um pedido", async () => {
    const created = await call(approvalsCreate, "/approvals", {
      method: "POST",
      body: {
        type: "scope_change",
        project: "VIT",
        title: "Incluir lembrete por SMS",
        payload: {
          milestones: [
            { code: "M1", acceptance_criteria: ["Lembrete por SMS"] },
          ],
        },
      },
    });
    const id = created.body.id as string;
    const list = await call(
      approvalsList,
      "/approvals?status=pending&mine=true",
    );
    expect((list.body.items as { id: string }[]).some((a) => a.id === id)).toBe(
      true,
    );
    const one = await call(approvalGet, `/approvals/${id}`, { params: { id } });
    expect(one.body).toMatchObject({
      id,
      type: "scope_change",
      status: "pending",
    });
  });

  it("relatórios: rascunho e lista; exportação do plan.md", async () => {
    const draft = await call(reportsPost, "/reports", {
      method: "POST",
      body: {
        project: "VIT",
        period_start: "2026-10-05",
        period_end: "2026-10-09",
        audience: "internal",
        body_md: "Semana de configuração do atendimento.",
      },
    });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({
      approval: { type: "status_report", status: "pending" },
    });
    const list = await call(reportsGet, "/reports?project=VIT");
    expect((list.body.items as unknown[]).length).toBe(1);

    const exported = await call(syncGet, "/sync/plan?project=VIT");
    expect(exported.body.markdown).toMatch(/## M1 — Agente no WhatsApp/);
    const noScope = await call(syncGet, "/sync/plan?project=VIT", {
      key: h.keys.leitor,
    });
    expect(noScope.status).toBe(403);
  });

  it("OpenAPI é público e descreve a API v1", async () => {
    const res = await openapiGet();
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/tasks/{code}/complete");
  });
});
