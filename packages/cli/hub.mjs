#!/usr/bin/env node
// hub · CLI do Hub de Gestão da Harmony Digital (PRD §8.5). Um arquivo só, sem
// dependências (Node 22 ou mais novo). Mensagens em PT-BR.
//
//   hub init --project VIT [--plan PLAN.md] [--url https://hub.harmonydigital.com.br]
//   hub plan pull
//   hub plan push [--commit <sha>] [--base <arquivo> | --base-ref <ref do git>] [--estrito]
//   hub task start HUB-12
//   hub task done HUB-12 --evidence "SHA, URL, arquivo ou teste"
//   hub task new "Título" [--under HUB-12] [--frente <id>]
//   hub today
//
// A chave do agente vem de HUB_API_KEY (nunca do arquivo de configuração). O endereço
// vem de HUB_URL, do .hub.json ou do padrão. A versão anterior do plano (para o push
// saber o que o autor do arquivo quis mudar) fica em .hub/plan.base.md, fora do git.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const VERSION = "0.1.0";
const DEFAULT_URL = "https://hub.harmonydigital.com.br";
const CONFIG = ".hub.json";
const BASE = path.join(".hub", "plan.base.md");
const CODE = /^[A-Z]{2,6}-\d{1,9}$/;

const HELP = `hub ${VERSION} · CLI do Hub de Gestão da Harmony Digital

Uso:
  hub init --project <CÓDIGO> [--plan PLAN.md] [--url <endereço do Hub>]
  hub plan pull                 traz o plan.md atualizado do Hub
  hub plan push [opções]        devolve ao Hub o que mudou no plan.md
      --commit <sha>            commit que trouxe o arquivo (vira evidência de item marcado)
      --base <arquivo>          versão anterior do plano (padrão: .hub/plan.base.md)
      --base-ref <ref>          versão anterior tirada do git (ex.: HEAD~1)
      --estrito                 sai com erro se houver conflitos
  hub task start <HUB-n>        começa a tarefa
  hub task done <HUB-n> --evidence "<SHA, URL, arquivo ou teste>"
  hub task new "<título>" [--under <HUB-n>] [--frente <id da frente>]
  hub today                     o que está com você hoje

A chave vem de HUB_API_KEY. O endereço vem de HUB_URL, do .hub.json ou de ${DEFAULT_URL}.`;

class CliError extends Error {}

/** Lê o .hub.json da pasta atual (ou de uma acima, até a raiz). */
export function findConfig(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  for (;;) {
    const file = path.join(dir, CONFIG);
    if (existsSync(file)) {
      let config;
      try {
        config = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        throw new CliError(`O ${CONFIG} em ${dir} não é um JSON válido.`);
      }
      if (typeof config.project !== "string") {
        throw new CliError(
          `O ${CONFIG} em ${dir} não diz o projeto ("project").`,
        );
      }
      return {
        dir,
        project: config.project,
        plan: config.plan_path || "PLAN.md",
        url: config.url,
      };
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function requireConfig(cwd) {
  const config = findConfig(cwd);
  if (!config) {
    throw new CliError(
      `Sem ${CONFIG} nesta pasta. Rode "hub init --project <CÓDIGO>" na raiz do repositório.`,
    );
  }
  return config;
}

export function client({
  env = process.env,
  config = null,
  fetchImpl = fetch,
} = {}) {
  const key = env.HUB_API_KEY?.trim();
  if (!key) {
    throw new CliError(
      "Falta a chave do agente: defina HUB_API_KEY no ambiente (a chave nunca vai para o .hub.json).",
    );
  }
  const base = (env.HUB_URL || config?.url || DEFAULT_URL).replace(/\/+$/, "");
  return async function call(method, route, body) {
    const headers = {
      authorization: `Bearer ${key}`,
      accept: "application/json",
      "user-agent": `hub-cli/${VERSION}`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") headers["idempotency-key"] = randomUUID();
    let res;
    try {
      res = await fetchImpl(`${base}/api/v1${route}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new CliError(
        `Não foi possível falar com o Hub em ${base}: ${err.message}`,
      );
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const detail =
        data?.detail || data?.title || text.slice(0, 200) || res.statusText;
      throw new CliError(`O Hub recusou (${res.status}): ${detail}`);
    }
    return data;
  };
}

function readPlan(config) {
  const file = path.join(config.dir, config.plan);
  return { file, text: existsSync(file) ? readFileSync(file, "utf8") : "" };
}

function saveBase(config, markdown) {
  const file = path.join(config.dir, BASE);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, markdown);
}

function gitShow(config, ref) {
  const relative = config.plan.split(path.sep).join("/");
  try {
    return execFileSync("git", ["show", `${ref}:${relative}`], {
      cwd: config.dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // arquivo novo nesse commit, ou fora de um repositório git
  }
}

function describe(result, out) {
  const s = result.summary;
  const parts = [
    [s.created, "criada(s)"],
    [s.completed, "concluída(s)"],
    [s.reopened, "reaberta(s)"],
    [s.renamed, "renomeada(s)"],
    [s.archived, "arquivada(s)"],
    [s.workstreams_created, "frente(s) nova(s)"],
    [s.inserted_in_file, "vinda(s) do Hub para o arquivo"],
    [s.updated_in_file, "caixa(s) acertada(s) no arquivo"],
  ]
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`);
  out(parts.length ? `  ${parts.join(", ")}.` : "  Nada mudou.");
  for (const c of result.conflicts) {
    out(`  ! ${c.line ? `linha ${c.line}: ` : ""}${c.detail}`);
  }
}

async function planSync(direction, args, ctx) {
  const config = requireConfig(ctx.cwd);
  const call = client({ env: ctx.env, config, fetchImpl: ctx.fetch });
  const plan = readPlan(config);
  const body = {
    project: config.project,
    direction,
    markdown: plan.text,
    via: "cli",
  };
  if (direction === "push") {
    if (args.commit) body.commit_sha = args.commit;
    const baseFile = args.base ?? path.join(config.dir, BASE);
    const base = args["base-ref"]
      ? gitShow(config, args["base-ref"])
      : existsSync(baseFile)
        ? readFileSync(baseFile, "utf8")
        : null;
    if (base !== null) body.base_markdown = base;
  }
  const result = await call("POST", "/sync/plan", body);
  if (result.changed) writeFileSync(plan.file, result.markdown);
  saveBase(config, result.markdown);
  ctx.out(
    `${direction === "pull" ? "Pull" : "Push"} de ${config.plan} (${config.project})${
      result.changed ? `: arquivo atualizado.` : ": arquivo já estava em dia."
    }`,
  );
  describe(result, ctx.out);
  if (args.estrito && result.conflicts.length > 0) {
    throw new CliError(`${result.conflicts.length} conflito(s).`);
  }
}

function needCode(value) {
  if (!value || !CODE.test(value)) {
    throw new CliError("Informe o código da tarefa, como HUB-12.");
  }
  return value;
}

async function init(args, ctx) {
  const project = args.project?.trim().toUpperCase();
  if (!project || !/^[A-Z0-9]{2,8}$/.test(project)) {
    throw new CliError("Informe o projeto: hub init --project VIT");
  }
  const config = { project, plan_path: args.plan || "PLAN.md" };
  if (args.url) config.url = args.url;
  const dir = ctx.cwd;
  writeFileSync(path.join(dir, CONFIG), `${JSON.stringify(config, null, 2)}\n`);
  // A versão anterior do plano é local: fica fora do git.
  const ignore = path.join(dir, ".gitignore");
  const current = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
  if (!/^\.hub\/?$/m.test(current)) {
    appendFileSync(
      ignore,
      `${current && !current.endsWith("\n") ? "\n" : ""}.hub/\n`,
    );
  }
  ctx.out(
    `Pronto: ${CONFIG} com o projeto ${project} e o plano ${config.plan_path}.`,
  );
  ctx.out('Agora defina HUB_API_KEY e rode "hub plan pull".');
}

async function task(sub, args, ctx) {
  const config = findConfig(ctx.cwd);
  const call = client({ env: ctx.env, config, fetchImpl: ctx.fetch });
  if (sub === "start") {
    const code = needCode(args.positionals[0]);
    const t = await call("POST", `/tasks/${code}/start`, {});
    ctx.out(`${t.code} em andamento: ${t.title}`);
    return;
  }
  if (sub === "done") {
    const code = needCode(args.positionals[0]);
    const evidence = args.evidence?.trim();
    if (!evidence) {
      throw new CliError(
        'Concluir pede a evidência: hub task done HUB-12 --evidence "SHA, URL, arquivo ou teste"',
      );
    }
    const t = await call("POST", `/tasks/${code}/complete`, { evidence });
    ctx.out(`${t.code} concluída: ${t.title}`);
    return;
  }
  if (sub === "new") {
    const title = args.positionals.join(" ").trim();
    if (!title) throw new CliError('Informe o título: hub task new "Título"');
    if (!config)
      throw new CliError(
        `Sem ${CONFIG}: rode "hub init" para dizer o projeto.`,
      );
    const body = { project: config.project, title };
    if (args.under) body.parent = needCode(args.under);
    if (args.frente) body.workstream_id = args.frente;
    const t = await call("POST", "/tasks", body);
    ctx.out(`${t.code} criada: ${t.title}`);
    return;
  }
  throw new CliError(
    'Use "hub task start", "hub task done" ou "hub task new".',
  );
}

async function today(ctx) {
  const config = findConfig(ctx.cwd);
  const call = client({ env: ctx.env, config, fetchImpl: ctx.fetch });
  const data = await call("GET", "/today");
  const tasks = data?.my_tasks ?? [];
  if (!tasks.length) {
    ctx.out("Nada com você agora.");
  } else {
    ctx.out("Com você:");
    for (const t of tasks) {
      ctx.out(
        `  ${t.code}  ${t.status_name ?? ""}  ${t.title}`.replace(/\s+$/, ""),
      );
    }
  }
  const waiting = data?.waiting_on_me ?? [];
  if (waiting.length) {
    ctx.out("Esperando você:");
    for (const t of waiting) ctx.out(`  ${t.code}  ${t.title}`);
  }
}

/** Roda o comando; devolve o código de saída (0 ok, 1 erro). */
export async function main(argv = process.argv.slice(2), ctx = {}) {
  const run = {
    cwd: ctx.cwd ?? process.cwd(),
    env: ctx.env ?? process.env,
    fetch: ctx.fetch ?? fetch,
    out: ctx.out ?? ((line) => process.stdout.write(`${line}\n`)),
    err: ctx.err ?? ((line) => process.stderr.write(`${line}\n`)),
  };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        project: { type: "string" },
        plan: { type: "string" },
        url: { type: "string" },
        commit: { type: "string" },
        base: { type: "string" },
        "base-ref": { type: "string" },
        estrito: { type: "boolean" },
        evidence: { type: "string" },
        under: { type: "string" },
        frente: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (err) {
    run.err(`${err.message}\n\n${HELP}`);
    return 1;
  }
  const { values, positionals } = parsed;
  const [command, sub, ...rest] = positionals;
  try {
    if (values.version) {
      run.out(VERSION);
      return 0;
    }
    if (values.help || !command) {
      run.out(HELP);
      return 0;
    }
    if (command === "init") await init(values, run);
    else if (command === "plan" && (sub === "pull" || sub === "push"))
      await planSync(sub, values, run);
    else if (command === "task")
      await task(sub, { ...values, positionals: rest }, run);
    else if (command === "today") await today(run);
    else
      throw new CliError(
        `Comando desconhecido: ${positionals.join(" ")}\n\n${HELP}`,
      );
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      run.err(err.message);
      return 1;
    }
    throw err;
  }
}

// Rodando como comando (inclusive pelo atalho do npm, que é um link para este arquivo).
const entry = process.argv[1]
  ? pathToFileURL(realpathSync(process.argv[1])).href
  : null;
if (entry === import.meta.url) {
  main().then((code) => {
    process.exitCode = code;
  });
}
