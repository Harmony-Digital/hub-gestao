import { z } from "zod";
import { unprocessable, type HubError } from "@/lib/errors";
import { attempt } from "@/modules/attempt";
import { ProjectCode, resolveProject } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { createComment } from "@/modules/comments/service";
import { createMilestone } from "@/modules/milestones/admin";
import { getPlan, renderPlanMarkdown } from "@/modules/projects/service";
import { CreateTaskInput } from "@/modules/tasks/schemas";
import {
  archiveTask,
  completeTask,
  createTask,
  reopenTask,
  updateTask,
} from "@/modules/tasks/service";
import {
  CreateWorkstreamInput,
  createWorkstream,
} from "@/modules/workstreams/service";
import {
  applyItemChanges,
  parsePlanFile,
  type ItemChange,
  type ParsedPlanFile,
  type PlanItem,
} from "./plan-file";
import {
  hubTasks,
  matchStructure,
  normalizeTitle,
  pullIntoFile,
} from "./plan-merge";

/**
 * Sincronização do plan.md com o Hub (PRD §5.5 e §8.5), pela API, pelo MCP e pela CLI.
 *
 * - **pull**: o Hub vai para o arquivo (caixas, critérios do GATE e as tarefas que faltam).
 * - **push**: o que mudou no arquivo vem para o Hub: itens sem código viram tarefas (e
 *   ganham o código), caixa marcada conclui com a evidência do item ou o commit,
 *   e, com a versão anterior do arquivo (`base_markdown`), desmarcar reabre, renomear
 *   renomeia e tirar o item arquiva a tarefa. Sem a versão anterior, o Hub vence.
 *
 * Regras fixas: o GATE marcado no arquivo nunca aceita o marco (é ignorado e alertado);
 * marco novo no arquivo não é criado (marco é decisão de pessoa); cada item é aplicado
 * à parte, e o que não der certo vira conflito, sem desfazer o resto. Toda execução fica
 * em `plan_sync_runs`, com o resumo e os conflitos.
 */

const MARKDOWN_MAX = 1_000_000;

export const SyncPlanInput = z.strictObject({
  project: ProjectCode,
  direction: z.enum(["pull", "push"]),
  markdown: z
    .string()
    .max(MARKDOWN_MAX)
    .describe("Conteúdo atual do plan.md, inteiro."),
  base_markdown: z
    .string()
    .max(MARKDOWN_MAX)
    .optional()
    .describe(
      "Push: o plan.md da última sincronização (ex.: o do commit anterior). Com ele, desmarcar reabre, renomear renomeia e tirar o item arquiva a tarefa.",
    ),
  commit_sha: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/i, "Use o SHA do commit (7 a 40 caracteres).")
    .optional()
    .describe(
      "Push: commit que trouxe o arquivo. Vira a evidência de item marcado sem evidência escrita.",
    ),
  via: z
    .string()
    .trim()
    .max(40)
    .optional()
    .describe('De onde veio a sincronização (ex.: "cli", "github-action").'),
});
export type SyncPlanInput = z.infer<typeof SyncPlanInput>;

export const SyncConflict = z.object({
  kind: z.enum([
    "gate_checked",
    "unknown_code",
    "duplicate_code",
    "milestone_missing",
    "hub_wins",
    "no_evidence",
    "refused",
  ]),
  line: z.number().int().nullable().describe("Linha do arquivo (começa em 1)."),
  code: z.string().nullable(),
  detail: z.string(),
});
export type SyncConflict = z.infer<typeof SyncConflict>;

export const SyncSummary = z.object({
  created: z.number().int(),
  linked: z
    .number()
    .int()
    .describe(
      "Itens sem código ligados a uma tarefa que já existia (mesmo título, mesma frente).",
    ),
  completed: z.number().int(),
  reopened: z.number().int(),
  renamed: z.number().int(),
  archived: z.number().int(),
  workstreams_created: z.number().int(),
  milestones_created: z
    .number()
    .int()
    .describe("Marcos criados (só na importação feita por pessoa)."),
  updated_in_file: z.number().int(),
  inserted_in_file: z.number().int(),
});
export type SyncSummary = z.infer<typeof SyncSummary>;

export const SyncPlanResult = z.object({
  project_code: ProjectCode,
  direction: z.enum(["pull", "push"]),
  run_id: z.string(),
  markdown: z.string().describe("O plan.md para gravar no repositório."),
  changed: z.boolean().describe("O arquivo mudou em relação ao enviado."),
  summary: SyncSummary,
  conflicts: z.array(SyncConflict),
});
export type SyncPlanResult = z.infer<typeof SyncPlanResult>;

async function workspacePrefix(t: TxCtx): Promise<string> {
  const row = await maybeOne<{ task_prefix: string }>(
    t,
    `select task_prefix from ${S}.workspaces where id = $1`,
    [t.actor.workspaceId],
  );
  return row?.task_prefix ?? "HUB";
}

const lineOf = (item: PlanItem) => item.line + 1;

async function recordRun(
  t: TxCtx,
  projectId: string,
  input: Pick<SyncPlanInput, "direction" | "via" | "commit_sha">,
  summary: SyncSummary,
  conflicts: SyncConflict[],
  direction: "pull" | "push" | "import" = input.direction,
): Promise<string> {
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.plan_sync_runs
       (workspace_id, project_id, direction, source, commit_sha, summary, conflicts)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     returning id`,
    [
      t.actor.workspaceId,
      projectId,
      direction,
      input.via || t.source,
      input.commit_sha ?? null,
      JSON.stringify(summary),
      JSON.stringify(conflicts),
    ],
  );
  return row!.id;
}

const emptySummary = (): SyncSummary => ({
  created: 0,
  linked: 0,
  completed: 0,
  reopened: 0,
  renamed: 0,
  archived: 0,
  workstreams_created: 0,
  milestones_created: 0,
  updated_in_file: 0,
  inserted_in_file: 0,
});

/** Pull ou push, conforme `direction`. */
export async function syncPlan(
  t: TxCtx,
  raw: z.input<typeof SyncPlanInput>,
): Promise<SyncPlanResult> {
  const input = SyncPlanInput.parse(raw);
  const project = await resolveProject(t, input.project, "sync.plan");
  const prefix = await workspacePrefix(t);
  const file = parsePlanFile(input.markdown, { prefix });
  const summary = emptySummary();
  const conflicts: SyncConflict[] = [];

  let current = file;
  if (input.direction === "push") {
    const base =
      input.base_markdown === undefined
        ? null
        : parsePlanFile(input.base_markdown, { prefix });
    // As mudanças rodam com origem "sync" (tarefas novas ficam com source plan_md).
    const changes = await push(
      { ...t, source: "sync" },
      project.code,
      file,
      base,
      input,
      summary,
      conflicts,
    );
    current = parsePlanFile(applyItemChanges(file, changes), { prefix });
  }

  // Nos dois sentidos, o arquivo devolvido é o do Hub depois das mudanças. Arquivo vazio
  // (projeto que ainda não tem plan.md) recebe a exportação completa, com o título.
  const plan = await getPlan(t, project.code, "sync.plan");
  const pulled = current.lines.some((l) => l.text.trim())
    ? pullIntoFile(current, plan)
    : {
        markdown: renderPlanMarkdown(plan),
        updated: 0,
        inserted: hubTasks(plan).size,
      };
  summary.updated_in_file = pulled.updated;
  summary.inserted_in_file = pulled.inserted;
  if (input.direction === "pull") collectGateAlerts(current, plan, conflicts);

  const runId = await recordRun(t, project.id, input, summary, conflicts);
  return {
    project_code: project.code,
    direction: input.direction,
    run_id: runId,
    markdown: pulled.markdown,
    changed: pulled.markdown !== input.markdown,
    summary,
    conflicts,
  };
}

/** GATE marcado no arquivo sem o marco aceito no Hub: alerta (nunca aceita). */
function collectGateAlerts(
  file: ParsedPlanFile,
  plan: Awaited<ReturnType<typeof getPlan>>,
  conflicts: SyncConflict[],
) {
  const match = matchStructure(file, plan);
  for (const item of file.items) {
    if (item.kind !== "criterion" || !item.checked) continue;
    const milestone =
      item.milestone === null ? null : match.milestones[item.milestone];
    if (milestone?.status === "accepted") continue;
    const criterion = milestone?.acceptance_criteria.find(
      (c) => normalizeTitle(c.text) === normalizeTitle(item.title),
    );
    if (criterion?.done) continue;
    conflicts.push({
      kind: "gate_checked",
      line: lineOf(item),
      code: null,
      detail:
        "Critério de GATE marcado no arquivo é ignorado: o aceite do marco é do Fábio, nas Aprovações do Hub.",
    });
  }
}

type PushOptions = {
  /** Importação por pessoa: os critérios do GATE já entram nos marcos criados. */
  importing?: { evidence: string };
};

async function push(
  t: TxCtx,
  projectCode: string,
  file: ParsedPlanFile,
  base: ParsedPlanFile | null,
  input: { commit_sha?: string },
  summary: SyncSummary,
  conflicts: SyncConflict[],
  options: PushOptions = {},
): Promise<ItemChange[]> {
  const plan = await getPlan(t, projectCode, "sync.plan");
  const match = matchStructure(file, plan);
  const tasks = hubTasks(plan);
  const baseByCode = new Map(
    (base?.items ?? [])
      .filter((i) => i.kind === "task" && i.code)
      .map((i) => [i.code as string, i]),
  );
  if (!options.importing) collectGateAlerts(file, plan, conflicts);

  const changes: ItemChange[] = [];
  const codeOfItem = new Map<number, string>();
  const seen = new Set<string>();
  // Tarefas de primeiro nível por frente (null: sem frente) e por código.
  type HubTask = (typeof plan.unplanned.tasks)[number];
  const byWorkstream = new Map<string | null, HubTask[]>([
    [null, plan.unplanned.tasks],
  ]);
  const topTasks = new Map<string, HubTask>();
  for (const w of [
    ...plan.milestones.flatMap((m) => m.workstreams),
    ...plan.unplanned.workstreams,
  ]) {
    byWorkstream.set(w.id, w.tasks);
  }
  for (const list of byWorkstream.values())
    for (const task of list) topTasks.set(task.code, task);
  const referenced = new Set(
    file.items.filter((i) => i.code).map((i) => i.code as string),
  );

  /**
   * Tarefa do Hub com o mesmo título, na mesma frente (ou sob a mesma tarefa-pai), que o
   * arquivo não cita: é o item de um push anterior cujo arquivo não voltou ao repositório
   * (a Action não regrava o plano). Ligar em vez de criar de novo.
   */
  const twinOf = (
    item: PlanItem,
    workstreamId: string | null,
    parentCode?: string,
  ) => {
    const pool = parentCode
      ? (topTasks.get(parentCode)?.subtasks ?? [])
      : (byWorkstream.get(workstreamId) ?? []);
    const title = normalizeTitle(item.title);
    return (
      pool.find(
        (task) =>
          normalizeTitle(task.title) === title &&
          !referenced.has(task.code) &&
          !seen.has(task.code),
      ) ?? null
    );
  };
  const missingMilestone = new Set<number>();
  const createdWorkstream = new Map<string, string>(); // chave → id da frente

  const evidenceFor = (item: PlanItem): string | null =>
    item.evidence ??
    (input.commit_sha
      ? `plan.md marcado no commit ${input.commit_sha.slice(0, 12)}`
      : (options.importing?.evidence ?? null));
  const refuse = (item: PlanItem, code: string | null, error: HubError) =>
    conflicts.push({
      kind: "refused",
      line: lineOf(item),
      code,
      detail: error.message,
    });

  /** Conclui pelo arquivo, com evidência; sem ela, vira conflito e comentário. */
  const complete = async (item: PlanItem, code: string) => {
    const evidence = evidenceFor(item);
    if (!evidence) {
      const detail = `${code} está marcada no plan.md, mas sem evidência. Escreva "— evidência: ..." no item ou conclua com a evidência (hub task done ${code} --evidence ...).`;
      conflicts.push({
        kind: "no_evidence",
        line: lineOf(item),
        code,
        detail,
      });
      await noteOnTask(t, code, `Sincronização do plan.md: ${detail}`);
      return;
    }
    const done = await attempt(t, () => completeTask(t, code, { evidence }));
    if (done.ok) summary.completed += 1;
    else refuse(item, code, done.error);
  };

  /** Frente do Hub para um item novo (achada, criada ou a "frente do marco"). */
  const workstreamFor = async (
    item: PlanItem,
  ): Promise<{ id: string | null } | null> => {
    const milestone =
      item.milestone === null ? null : match.milestones[item.milestone];
    if (item.milestone !== null && !milestone) {
      if (!missingMilestone.has(item.milestone)) {
        missingMilestone.add(item.milestone);
        const m = file.milestones[item.milestone];
        conflicts.push({
          kind: "milestone_missing",
          line: m.line + 1,
          code: null,
          detail: `O marco "${m.title}" não existe no Hub. Marco é decisão de pessoa: crie pela tela (Novo marco, na Visão geral do projeto) e sincronize de novo. Os itens dele ficaram de fora.`,
        });
      }
      return null;
    }
    let title: string | null = null;
    if (item.workstream !== null) {
      const found = match.workstreams[item.workstream];
      if (found) return { id: found.id };
      title = file.workstreams[item.workstream].title;
    } else if (milestone) {
      // Item direto embaixo do `##`: vai para a frente com o nome do marco.
      const own = milestone.workstreams.find(
        (w) => normalizeTitle(w.title) === normalizeTitle(milestone.title),
      );
      if (own) return { id: own.id };
      title = milestone.title;
    } else {
      return { id: null }; // sem marco e sem frente
    }
    const key = `${milestone?.id ?? "-"}|${normalizeTitle(title)}`;
    const cached = createdWorkstream.get(key);
    if (cached) return { id: cached };
    const created = await attempt(t, () =>
      createWorkstream(
        t,
        CreateWorkstreamInput.parse({
          project: projectCode,
          title: title.slice(0, 200),
          ...(milestone ? { milestone: milestone.code } : {}),
        }),
      ),
    );
    if (!created.ok) {
      refuse(item, null, created.error);
      return null;
    }
    summary.workstreams_created += 1;
    createdWorkstream.set(key, created.value.id);
    return { id: created.value.id };
  };

  /** Item com tarefa conhecida no Hub: caixa (e o título, com a versão anterior). */
  const reconcile = async (
    item: PlanItem,
    code: string,
    hub: { title: string; status_category: string },
  ) => {
    const before = baseByCode.get(code);
    const hubDone = hub.status_category === "done";
    if (item.checked && !hubDone) {
      if (before?.checked) {
        conflicts.push({
          kind: "hub_wins",
          line: lineOf(item),
          code,
          detail: `${code} foi reaberta no Hub depois da última sincronização; o Hub vence e o arquivo volta a ficar desmarcado.`,
        });
      } else {
        await complete(item, code);
      }
    } else if (!item.checked && hubDone) {
      if (before?.checked) {
        const reopened = await attempt(t, () =>
          reopenTask(t, code, { reason: "Desmarcada no plan.md." }),
        );
        if (reopened.ok) summary.reopened += 1;
        else refuse(item, code, reopened.error);
      } else {
        conflicts.push({
          kind: "hub_wins",
          line: lineOf(item),
          code,
          detail: `${code} está concluída no Hub e desmarcada no arquivo; o Hub vence e o arquivo volta a ficar marcado.`,
        });
      }
    }
    // Título: só com a versão anterior, e se o Hub ainda tem o título antigo.
    if (
      before &&
      item.title &&
      before.title !== item.title &&
      normalizeTitle(hub.title) === normalizeTitle(before.title)
    ) {
      const renamed = await attempt(t, () =>
        updateTask(t, code, { title: item.title }),
      );
      if (renamed.ok) summary.renamed += 1;
      else refuse(item, code, renamed.error);
    }
  };

  for (const [index, item] of file.items.entries()) {
    if (item.kind === "criterion") continue;

    if (item.code) {
      const code = item.code;
      if (seen.has(code)) {
        conflicts.push({
          kind: "duplicate_code",
          line: lineOf(item),
          code,
          detail: `${code} aparece mais de uma vez no arquivo; só a primeira conta.`,
        });
        continue;
      }
      seen.add(code);
      codeOfItem.set(index, code);
      const hub = tasks.get(code);
      if (!hub) {
        conflicts.push({
          kind: "unknown_code",
          line: lineOf(item),
          code,
          detail: `${code} não está entre as tarefas ativas do projeto ${projectCode} (outro projeto, arquivada ou inexistente).`,
        });
        continue;
      }
      await reconcile(item, code, hub);
      continue;
    }

    // Item novo. Riscado é cancelado no plano: não vira tarefa.
    if (item.struck || !item.title) continue;
    const parentCode =
      item.parent === null ? undefined : codeOfItem.get(item.parent);
    if (item.parent !== null && !parentCode) continue; // pai ficou de fora
    const workstream = parentCode ? { id: null } : await workstreamFor(item);
    if (!workstream) continue;
    const twin = twinOf(item, workstream.id, parentCode);
    if (twin) {
      seen.add(twin.code);
      codeOfItem.set(index, twin.code);
      changes.push({ item: index, code: twin.code });
      summary.linked += 1;
      await reconcile(item, twin.code, twin);
      continue;
    }
    const note =
      item.note && !item.evidence ? item.note.slice(0, 20000) : undefined;
    const created = await attempt(t, () =>
      createTask(
        t,
        CreateTaskInput.parse({
          project: projectCode,
          title: item.title,
          ...(note ? { description_md: note } : {}),
          ...(workstream.id ? { workstream_id: workstream.id } : {}),
          ...(parentCode ? { parent: parentCode } : {}),
        }),
      ),
    );
    if (!created.ok) {
      refuse(item, null, created.error);
      continue;
    }
    const code = created.value.code;
    summary.created += 1;
    codeOfItem.set(index, code);
    changes.push({ item: index, code });
    if (item.checked) await complete(item, code);
  }

  // Itens que saíram do arquivo (só se sabe com a versão anterior): arquivar.
  if (base) {
    for (const [code, before] of baseByCode) {
      if (seen.has(code) || !tasks.has(code)) continue;
      const archived = await attempt(t, () =>
        archiveTask(t, code, { reason: "Saiu do plan.md." }),
      );
      if (archived.ok) summary.archived += 1;
      else refuse(before, code, archived.error);
    }
  }
  return changes;
}

/** Comentário interno na tarefa, sem repetir o mesmo aviso a cada sincronização. */
async function noteOnTask(t: TxCtx, code: string, body: string) {
  const repeated = await many<{ id: string }>(
    t,
    `select c.id from ${S}.comments c
       join ${S}.tasks k on k.id = c.entity_id and c.entity_type = 'task'
      where k.code = $1 and c.body_md = $2
      limit 1`,
    [code, body],
  );
  if (repeated.length > 0) return;
  // Sem o escopo de comentários, o aviso fica só no registro da sincronização.
  await attempt(t, () => createComment(t, { task: code }, { body_md: body }));
}

export const ImportPlanInput = z.strictObject({
  project: ProjectCode,
  markdown: z.string().max(MARKDOWN_MAX),
  dry_run: z.boolean().optional(),
});
export type ImportPlanInput = z.infer<typeof ImportPlanInput>;

export type ImportPlanResult = SyncPlanResult & {
  dry_run: boolean;
  milestones: { code: string; title: string; status: string }[];
};

/** Status do marco novo pelo que o arquivo mostra. */
function milestoneStatus(file: ParsedPlanFile, index: number) {
  const m = file.milestones[index];
  const criteria = file.items.filter(
    (i) => i.milestone === index && i.kind === "criterion",
  );
  if (m.done || (criteria.length > 0 && criteria.every((c) => c.checked))) {
    return "delivered" as const;
  }
  const started = file.items.some(
    (i) => i.milestone === index && i.kind === "task" && i.checked,
  );
  return started ? ("in_progress" as const) : ("planned" as const);
}

/**
 * Importação do plan.md por pessoa (dono ou administração): cria os marcos que faltam,
 * com o código e a ordem do arquivo e os critérios do GATE, e então aplica o push normal
 * (frentes, tarefas e subtarefas). Item marcado sem evidência escrita é concluído com a
 * nota da importação. Marco entra no máximo como Entregue: o aceite continua sendo
 * pedido e decidido nas Aprovações. Com `dry_run`, faz tudo e desfaz no fim (a prévia).
 *
 * `importer`: o agente importador (D10, escopo projects:import), só em projeto em revisão;
 * os marcos entram como Planejado (o banco também exige) e o projeto só passa a valer com
 * o ok do Fábio no pedido import_review (src/modules/projects/import.ts).
 */
export async function importPlan(
  t: TxCtx,
  raw: z.input<typeof ImportPlanInput>,
  options: { importer?: boolean } = {},
): Promise<ImportPlanResult> {
  const input = ImportPlanInput.parse(raw);
  const importer = options.importer === true;
  // Marco é decisão de pessoa: agente recebe 403 aqui, menos o importador em revisão.
  const project = await resolveProject(
    t,
    input.project,
    importer ? "project.import" : "milestone.write",
  );
  if (importer && project.status !== "in_review") {
    throw unprocessable(
      `O projeto ${project.code} não está em revisão: a importação por agente vale só para projeto novo, cadastrado com hub_create_project. Para um projeto que já está no Hub, use hub_sync_plan.`,
    );
  }
  const prefix = await workspacePrefix(t);
  const file = parsePlanFile(input.markdown, { prefix });
  const summary = emptySummary();
  const conflicts: SyncConflict[] = [];
  const created: ImportPlanResult["milestones"] = [];
  const dryRun = input.dry_run === true;
  if (dryRun) await t.tx.query("savepoint hub_import_preview");

  // Marcos que faltam: primeiro os que trazem código (para o código do arquivo ficar
  // livre), depois os outros, sempre na posição do arquivo.
  const before = await getPlan(t, project.code, "milestone.read");
  const match = matchStructure(file, before);
  const offset = before.milestones.reduce(
    (max, m) => Math.max(max, m.sort_order),
    0,
  );
  const missing = file.milestones
    .map((m, index) => ({ m, index }))
    .filter(({ index }) => !match.milestones[index])
    .sort((a, b) => Number(!a.m.code) - Number(!b.m.code));
  for (const { m, index } of missing) {
    const criteria = file.items
      .filter((i) => i.milestone === index && i.kind === "criterion")
      .slice(0, 30)
      .map((c) => ({ text: c.title.slice(0, 300), done: c.checked }));
    const made = await attempt(t, () =>
      createMilestone(
        t,
        project.code,
        {
          title: m.title.slice(0, 200),
          title_client: null,
          description_client: null,
          due_date: null,
          // O importador cria tudo como Planejado; quem marca o andamento é a pessoa.
          status: importer ? "planned" : milestoneStatus(file, index),
          visibility: "internal",
          acceptance_criteria: criteria,
        },
        {
          code: m.code ?? undefined,
          sortOrder: offset + index + 1,
          importer,
        },
      ),
    );
    if (!made.ok) {
      conflicts.push({
        kind: "refused",
        line: m.line + 1,
        code: null,
        detail: made.error.message,
      });
      continue;
    }
    summary.milestones_created += 1;
    created.push({
      code: made.value.code,
      title: made.value.title,
      status: made.value.status,
    });
  }
  created.sort((a, b) =>
    a.code.localeCompare(b.code, "pt-BR", { numeric: true }),
  );

  const today = new Date().toISOString().slice(0, 10);
  const changes = await push(
    { ...t, source: "sync" },
    project.code,
    file,
    null,
    {},
    summary,
    conflicts,
    {
      importing: {
        evidence: `Já estava concluída no plan.md quando ele foi importado (${today}).`,
      },
    },
  );
  const current = parsePlanFile(applyItemChanges(file, changes), { prefix });
  const plan = await getPlan(t, project.code, "sync.plan");
  const pulled = pullIntoFile(current, plan);
  summary.updated_in_file = pulled.updated;
  summary.inserted_in_file = pulled.inserted;

  let runId = "";
  if (dryRun) {
    await t.tx.query("rollback to savepoint hub_import_preview");
  } else {
    runId = await recordRun(
      t,
      project.id,
      { direction: "push", via: importer ? "mcp" : "tela" },
      summary,
      conflicts,
      "import",
    );
  }
  return {
    project_code: project.code,
    direction: "push",
    run_id: runId,
    markdown: pulled.markdown,
    changed: pulled.markdown !== input.markdown,
    summary,
    conflicts,
    dry_run: dryRun,
    milestones: created,
  };
}
