import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDbForTests } from "@/lib/db";
import { count, openTestHub, TEST_PEPPER, type TestHub } from "@/test/hub";
import { GET as getMe } from "./me/route";
import { GET as getProjects } from "./projects/route";
import { GET as getProject } from "./projects/[code]/route";
import { GET as getPlan } from "./projects/[code]/plan/route";
import { GET as listTasksRoute, POST as createTaskRoute } from "./tasks/route";
import {
  GET as getTaskRoute,
  PATCH as patchTaskRoute,
} from "./tasks/[code]/route";
import { POST as startRoute } from "./tasks/[code]/start/route";
import { POST as completeRoute } from "./tasks/[code]/complete/route";
import { POST as commentRoute } from "./tasks/[code]/comments/route";
import { POST as requestApprovalRoute } from "./approvals/route";
import { POST as decideRoute } from "./approvals/[id]/decide/route";
import { GET as searchRoute } from "./search/route";
import { POST as syncPushRoute } from "./sync/plan/route";
import { GET as todayRoute } from "./today/route";

const S = "proj_hub_gestao";
let h: TestHub;

beforeAll(async () => {
  process.env.HUB_API_KEY_PEPPER = TEST_PEPPER;
  h = await openTestHub();
  setDbForTests(h.db);
});
afterAll(async () => {
  setDbForTests(null);
  await h.db.close();
});

type Handler<P> = (
  req: Request,
  ctx: { params: Promise<P> },
) => Promise<Response>;

async function call<P extends Record<string, string>>(
  handler: Handler<P> | ((req: Request) => Promise<Response>),
  options: {
    method?: string;
    path: string;
    key?: string;
    body?: unknown;
    params?: P;
    headers?: Record<string, string>;
    idempotencyKey?: string | null;
  },
) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.key) headers.authorization = `Bearer ${options.key}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey)
    headers["idempotency-key"] = options.idempotencyKey;
  const req = new Request(`http://hub.test/api/v1${options.path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const res = await (handler as Handler<P>)(req, {
    params: Promise.resolve((options.params ?? {}) as P),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

let n = 0;
const ikey = () => `teste-api-${Date.now()}-${n++}`;

describe("autenticação", () => {
  it("sem chave: 401 em problem+json, com WWW-Authenticate", async () => {
    const res = await call(getMe, { path: "/me" });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    expect(res.body).toMatchObject({
      status: 401,
      type: expect.stringContaining("/problemas/unauthorized"),
    });
  });

  it("chave errada: 401; agente pausado: 423", async () => {
    const wrong = h.keys.kratos.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await call(getMe, { path: "/me", key: wrong })).status).toBe(401);
    expect(
      (await call(getMe, { path: "/me", key: h.keys.pausado })).status,
    ).toBe(423);
  });

  it("/me mostra a identidade, os projetos e os escopos da chave", async () => {
    const res = await call(getMe, { path: "/me", key: h.keys.kratos });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      actor: { type: "agent", name: "Kratos", roles: ["GP-01", "VP-05"] },
      workspace: { slug: "harmony" },
      projects: [{ code: "VIT" }],
      all_projects: false,
      budget: { month_usd: 10, remaining_usd: 10 },
    });
    expect((res.body!.key as { scopes: string[] }).scopes).toContain(
      "tasks:complete",
    );
  });

  it("limite de pedidos por chave: 429 com Retry-After", async () => {
    process.env.HUB_RATE_LIMIT_PER_MIN = "2";
    try {
      expect(
        (await call(getMe, { path: "/me", key: h.keys.leitor })).status,
      ).toBe(200);
      expect(
        (await call(getMe, { path: "/me", key: h.keys.leitor })).status,
      ).toBe(200);
      const limited = await call(getMe, { path: "/me", key: h.keys.leitor });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    } finally {
      delete process.env.HUB_RATE_LIMIT_PER_MIN;
    }
  });
});

describe("projetos e escopo", () => {
  it("a chave vê só os projetos dela", async () => {
    const list = await call(getProjects, {
      path: "/projects",
      key: h.keys.kratos,
    });
    expect((list.body!.items as { code: string }[]).map((p) => p.code)).toEqual(
      ["VIT"],
    );
    const hub = await call(getProject, {
      path: "/projects/HUB",
      key: h.keys.kratos,
      params: { code: "HUB" },
    });
    expect(hub.status).toBe(403);
    expect(hub.body!.detail).toMatch(/não dá acesso/);
  });

  it("plano em JSON e em plan.md", async () => {
    const json = await call(getPlan, {
      path: "/projects/VIT/plan",
      key: h.keys.kratos,
      params: { code: "VIT" },
    });
    expect(json.status).toBe(200);
    expect((json.body!.milestones as { code: string }[])[0].code).toBe("M1");
    const md = await call(getPlan, {
      path: "/projects/VIT/plan?format=md",
      key: h.keys.kratos,
      params: { code: "VIT" },
    });
    expect(md.body!.markdown).toMatch(/^# PLAN\.md — Atendimento com IA/);
    expect(md.body!.markdown).toMatch(/## M1 — Agente no WhatsApp/);
    expect(md.body!.markdown).toMatch(/### 🔒 GATE M1/);
  });
});

describe("tarefas pela API", () => {
  let code = "";

  it("escrita exige Idempotency-Key", async () => {
    const res = await call(createTaskRoute, {
      method: "POST",
      path: "/tasks",
      key: h.keys.kratos,
      body: { project: "VIT", title: "Sem chave" },
    });
    expect(res.status).toBe(400);
    expect(res.body!.detail).toMatch(/Idempotency-Key/);
  });

  it("campo desconhecido vira 400 com a lista do que corrigir", async () => {
    const res = await call(createTaskRoute, {
      method: "POST",
      path: "/tasks",
      key: h.keys.kratos,
      idempotencyKey: ikey(),
      body: { project: "VIT", title: "Com campo a mais", status: "done" },
    });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body!.errors)).toBe(true);
  });

  it("cria (201), repete com a mesma chave (mesma resposta) e recusa a chave com outro corpo (409)", async () => {
    const key = ikey();
    const body = {
      project: "VIT",
      title: "Revisar respostas frequentes",
      priority: "high",
    };
    const first = await call(createTaskRoute, {
      method: "POST",
      path: "/tasks",
      key: h.keys.kratos,
      idempotencyKey: key,
      body,
    });
    expect(first.status).toBe(201);
    expect(first.headers.get("idempotent-replayed")).toBe("false");
    expect(first.headers.get("etag")).toBe('W/"v1"');
    code = first.body!.code as string;

    const again = await call(createTaskRoute, {
      method: "POST",
      path: "/tasks",
      key: h.keys.kratos,
      idempotencyKey: key,
      body,
    });
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body!.code).toBe(code);

    const other = await call(createTaskRoute, {
      method: "POST",
      path: "/tasks",
      key: h.keys.kratos,
      idempotencyKey: key,
      body: { ...body, title: "Outro corpo" },
    });
    expect(other.status).toBe(409);
    expect(
      await count(
        h,
        `select count(*)::int as n from ${S}.tasks where title = 'Revisar respostas frequentes'`,
      ),
    ).toBe(1);
  });

  it("PATCH com If-Match: versão velha dá 412; versão certa atualiza", async () => {
    const read = await call(getTaskRoute, {
      path: `/tasks/${code}`,
      key: h.keys.kratos,
      params: { code },
    });
    expect(read.headers.get("etag")).toBe('W/"v1"');
    const stale = await call(patchTaskRoute, {
      method: "PATCH",
      path: `/tasks/${code}`,
      key: h.keys.kratos,
      idempotencyKey: ikey(),
      headers: { "if-match": 'W/"v0"' },
      params: { code },
      body: { priority: "urgent" },
    });
    expect(stale.status).toBe(412);
    const ok = await call(patchTaskRoute, {
      method: "PATCH",
      path: `/tasks/${code}`,
      key: h.keys.kratos,
      idempotencyKey: ikey(),
      headers: { "if-match": read.headers.get("etag")! },
      params: { code },
      body: { priority: "urgent" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ priority: "urgent", version: 2 });
  });

  it("iniciar, comentar com papel declarado e concluir com evidência", async () => {
    const started = await call(startRoute, {
      method: "POST",
      path: `/tasks/${code}/start`,
      key: h.keys.kratos,
      idempotencyKey: ikey(),
      params: { code },
    });
    expect(started.status).toBe(200);
    expect((started.body!.status as { category: string }).category).toBe(
      "in_progress",
    );

    const badRole = await call(commentRoute, {
      method: "POST",
      path: `/tasks/${code}/comments`,
      key: h.keys.kratos,
      idempotencyKey: ikey(),
      headers: { "hub-acting-role": "QA-04" },
      params: { code },
      body: { body_md: "Papel que o Kratos não tem." },
    });
    expect(badRole.status).toBe(400);

    const comment = await call(commentRoute, {
      method: "POST",
      path: `/tasks/${code}/comments`,
      key: h.keys.kratos,
      idempotencyKey: ikey(),
      headers: { "hub-acting-role": "GP-01" },
      params: { code },
      body: { body_md: "Respostas revisadas com o time." },
    });
    expect(comment.status).toBe(201);
    expect(comment.body).toMatchObject({
      visibility: "internal",
      acting_role: "GP-01",
    });

    const noEvidence = await call(completeRoute, {
      method: "POST",
      path: `/tasks/${code}/complete`,
      key: h.keys.kratos,
      idempotencyKey: ikey(),
      params: { code },
      body: {},
    });
    expect(noEvidence.status).toBe(400);

    const done = await call(completeRoute, {
      method: "POST",
      path: `/tasks/${code}/complete`,
      key: h.keys.kratos,
      idempotencyKey: ikey(),
      params: { code },
      body: { evidence: "https://github.com/Harmony-Digital/exemplo/pull/7" },
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({
      done_evidence: "https://github.com/Harmony-Digital/exemplo/pull/7",
    });

    const log = await h.raw.query<{
      action: string;
      source: string;
      acting_role: string | null;
    }>(
      `select action, source, acting_role from ${S}.activity_log
        where entity_id = (select id from ${S}.tasks where code = $1) order by id`,
      [code],
    );
    expect(log.rows.map((r) => r.action)).toEqual([
      "task.created",
      "task.updated",
      "task.started",
      "task.completed",
    ]);
    expect(log.rows.every((r) => r.source === "api")).toBe(true);
  });

  it("lista com filtros na query string", async () => {
    const res = await call(listTasksRoute, {
      path: "/tasks?project=VIT&status_category=done,review&limit=10",
      key: h.keys.kratos,
    });
    expect(res.status).toBe(200);
    const items = res.body!.items as { status: { category: string } }[];
    expect(items.length).toBeGreaterThan(0);
    expect(
      items.every((t) => ["done", "review"].includes(t.status.category)),
    ).toBe(true);
    const bad = await call(listTasksRoute, {
      path: "/tasks?blocked=talvez",
      key: h.keys.kratos,
    });
    expect(bad.status).toBe(400);
  });

  it("corpo que não é JSON: 415", async () => {
    const req = new Request("http://hub.test/api/v1/tasks", {
      method: "POST",
      headers: {
        authorization: `Bearer ${h.keys.kratos}`,
        "idempotency-key": ikey(),
        "content-type": "text/plain",
      },
      body: "título solto",
    });
    expect((await createTaskRoute(req)).status).toBe(415);
  });
});

describe("governança pela API", () => {
  it("agente pede aprovação, mas decidir é sempre 403", async () => {
    const requested = await call(requestApprovalRoute, {
      method: "POST",
      path: "/approvals",
      key: h.keys.kratos,
      idempotencyKey: ikey(),
      body: {
        type: "replan",
        project: "VIT",
        title: "Replanejar o M1 em uma semana",
      },
    });
    expect(requested.status).toBe(201);
    const id = requested.body!.id as string;
    const decided = await call(decideRoute, {
      method: "POST",
      path: `/approvals/${id}/decide`,
      key: h.keys.todos,
      idempotencyKey: ikey(),
      params: { id },
      body: { decision: "approved" },
    });
    expect(decided.status).toBe(403);
    expect(decided.body!.human_only).toBe(true);
  });

  it("busca, fila do dia e sincronização que ainda não existe (501)", async () => {
    const found = await call(searchRoute, {
      path: "/search?q=WhatsApp",
      key: h.keys.kratos,
    });
    expect((found.body!.milestones as { code: string }[])[0].code).toBe("M1");
    const today = await call(todayRoute, {
      path: "/today",
      key: h.keys.kratos,
    });
    expect(today.status).toBe(200);
    expect(today.body).toHaveProperty("counts");
    const push = await call(syncPushRoute, {
      method: "POST",
      path: "/sync/plan",
      key: h.keys.kratos,
      idempotencyKey: ikey(),
      body: {},
    });
    expect(push.status).toBe(501);
  });
});
