// Testes da CLI hub (node --test), com um Hub simulado no lugar da rede.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { main } from "./hub.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-cli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Roda a CLI com um Hub simulado; devolve o código de saída, a saída e os pedidos. */
async function run(argv, { reply = () => ({ body: {} }), env = {} } = {}) {
  const calls = [];
  const out = [];
  const err = [];
  const code = await main(argv, {
    cwd: dir,
    env: { HUB_API_KEY: "hub_ak_teste.segredo", ...env },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fetch: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init.method, headers: init.headers, body });
      const { status = 200, body: response } = reply(url, body);
      return new Response(JSON.stringify(response), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  return { code, out: out.join("\n"), err: err.join("\n"), calls };
}

const syncResult = (markdown, extra = {}) => ({
  project_code: "VIT",
  direction: "push",
  run_id: "r1",
  markdown,
  changed: true,
  summary: {
    created: 1,
    completed: 0,
    reopened: 0,
    renamed: 0,
    archived: 0,
    workstreams_created: 0,
    updated_in_file: 0,
    inserted_in_file: 0,
  },
  conflicts: [],
  ...extra,
});

test("init grava o .hub.json e tira a pasta .hub/ do git, sem repetir", async () => {
  writeFileSync(path.join(dir, ".gitignore"), "node_modules");
  const first = await run(["init", "--project", "vit"]);
  assert.equal(first.code, 0);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(dir, ".hub.json"), "utf8")),
    {
      project: "VIT",
      plan_path: "PLAN.md",
    },
  );
  await run(["init", "--project", "VIT", "--plan", "docs/plano.md"]);
  assert.equal(
    readFileSync(path.join(dir, ".gitignore"), "utf8"),
    "node_modules\n.hub/\n",
  );
  assert.equal(
    JSON.parse(readFileSync(path.join(dir, ".hub.json"), "utf8")).plan_path,
    "docs/plano.md",
  );
  const bad = await run(["init", "--project", "x"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /Informe o projeto/);
});

test("sem a chave ou sem o .hub.json, explica o que falta", async () => {
  const noKey = await run(["today"], { env: { HUB_API_KEY: "" } });
  assert.equal(noKey.code, 1);
  assert.match(noKey.err, /HUB_API_KEY/);
  const noConfig = await run(["plan", "pull"]);
  assert.equal(noConfig.code, 1);
  assert.match(noConfig.err, /hub init/);
});

test("plan pull manda o arquivo, grava o que voltou e guarda a versão base", async () => {
  await run(["init", "--project", "VIT"]);
  writeFileSync(path.join(dir, "PLAN.md"), "## M1 — A\n");
  const res = await run(["plan", "pull"], {
    env: { HUB_URL: "https://hub.exemplo/" },
    reply: () => ({
      body: syncResult("## M1 — A\n- [ ] Nova (HUB-9)\n", {
        direction: "pull",
        summary: { ...syncResult("").summary, created: 0, inserted_in_file: 1 },
      }),
    }),
  });
  assert.equal(res.code, 0, res.err);
  const [call] = res.calls;
  assert.equal(call.url, "https://hub.exemplo/api/v1/sync/plan");
  assert.equal(call.method, "POST");
  assert.equal(call.headers.authorization, "Bearer hub_ak_teste.segredo");
  assert.ok(call.headers["idempotency-key"]);
  assert.deepEqual(call.body, {
    project: "VIT",
    direction: "pull",
    markdown: "## M1 — A\n",
    via: "cli",
  });
  const saved = "## M1 — A\n- [ ] Nova (HUB-9)\n";
  assert.equal(readFileSync(path.join(dir, "PLAN.md"), "utf8"), saved);
  assert.equal(
    readFileSync(path.join(dir, ".hub", "plan.base.md"), "utf8"),
    saved,
  );
  assert.match(res.out, /arquivo atualizado/);
  assert.match(res.out, /1 vinda\(s\) do Hub para o arquivo/);
});

test("plan push leva a base e o commit, mostra os conflitos e falha no modo estrito", async () => {
  await run(["init", "--project", "VIT"]);
  writeFileSync(path.join(dir, "PLAN.md"), "## M1 — A\n- [x] Feita\n");
  writeFileSync(
    path.join(dir, ".hub.json"),
    JSON.stringify({ project: "VIT" }),
  );
  await run(["plan", "pull"], {
    reply: () => ({ body: syncResult("## M1 — A\n- [ ] Feita\n") }),
  });
  writeFileSync(path.join(dir, "PLAN.md"), "## M1 — A\n- [x] Feita\n");
  const reply = () => ({
    body: syncResult("## M1 — A\n- [x] Feita (HUB-3)\n", {
      conflicts: [
        {
          kind: "gate_checked",
          line: 4,
          code: null,
          detail: "GATE marcado é ignorado.",
        },
      ],
    }),
  });
  const res = await run(["plan", "push", "--commit", "abc1234"], { reply });
  assert.equal(res.code, 0, res.err);
  assert.equal(res.calls[0].body.base_markdown, "## M1 — A\n- [ ] Feita\n");
  assert.equal(res.calls[0].body.commit_sha, "abc1234");
  assert.match(res.out, /linha 4: GATE marcado é ignorado/);
  const strict = await run(["plan", "push", "--estrito"], { reply });
  assert.equal(strict.code, 1);
  assert.match(strict.err, /1 conflito/);
});

test("task done exige a evidência; task new usa o projeto do .hub.json", async () => {
  await run(["init", "--project", "VIT"]);
  const missing = await run(["task", "done", "HUB-1"]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /evidência/);
  const done = await run(["task", "done", "HUB-1", "--evidence", "PR #12"], {
    reply: () => ({ body: { code: "HUB-1", title: "Feita" } }),
  });
  assert.equal(done.code, 0, done.err);
  assert.equal(
    done.calls[0].url,
    "https://hub.harmonydigital.com.br/api/v1/tasks/HUB-1/complete",
  );
  assert.deepEqual(done.calls[0].body, { evidence: "PR #12" });
  const created = await run(
    ["task", "new", "Nova", "tarefa", "--under", "HUB-1"],
    {
      reply: () => ({ body: { code: "HUB-2", title: "Nova tarefa" } }),
    },
  );
  assert.equal(created.code, 0, created.err);
  assert.deepEqual(created.calls[0].body, {
    project: "VIT",
    title: "Nova tarefa",
    parent: "HUB-1",
  });
  assert.match(created.out, /HUB-2 criada/);
  const badCode = await run(["task", "start", "hub-1"]);
  assert.equal(badCode.code, 1);
  assert.match(badCode.err, /HUB-12/);
});

test("today mostra a fila; recusa do Hub vira mensagem clara", async () => {
  const today = await run(["today"], {
    reply: () => ({
      body: {
        my_tasks: [
          { code: "HUB-4", title: "Revisar", status_name: "Em andamento" },
        ],
        waiting_on_me: [{ code: "HUB-5", title: "Destravar" }],
      },
    }),
  });
  assert.equal(today.code, 0, today.err);
  assert.equal(today.calls[0].method, "GET");
  assert.equal(today.calls[0].headers["idempotency-key"], undefined);
  assert.match(today.out, /HUB-4 {2}Em andamento {2}Revisar/);
  assert.match(today.out, /Esperando você:\n {2}HUB-5 {2}Destravar/);
  const refused = await run(["today"], {
    reply: () => ({
      status: 403,
      body: { detail: "A chave não tem o escopo tasks:read." },
    }),
  });
  assert.equal(refused.code, 1);
  assert.equal(
    refused.err,
    "O Hub recusou (403): A chave não tem o escopo tasks:read.",
  );
});

test("sem arquivo de plano ainda, o pull começa de um arquivo vazio", async () => {
  await run(["init", "--project", "VIT"]);
  const res = await run(["plan", "pull"], {
    reply: () => ({ body: syncResult("# Plano\n") }),
  });
  assert.equal(res.code, 0, res.err);
  assert.equal(res.calls[0].body.markdown, "");
  assert.ok(existsSync(path.join(dir, "PLAN.md")));
});
