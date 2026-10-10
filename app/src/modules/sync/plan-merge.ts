/**
 * Encontro do plan.md com o Hub (PRD §8.5), sem banco: qual marco e qual frente do
 * arquivo correspondem a quais do Hub, e o pull, que leva o estado do Hub para o arquivo
 * (caixas das tarefas e dos critérios de GATE) e insere, no lugar certo, as tarefas que
 * só existem no Hub. O Hub vence; o arquivo fica byte a byte igual fora do que muda.
 */

import type { PlanDto } from "@/modules/projects/schemas";
import {
  applyItemChanges,
  splitPlanLines,
  type ItemChange,
  type ParsedPlanFile,
} from "./plan-file";

type HubMilestone = PlanDto["milestones"][number];
type HubWorkstream = HubMilestone["workstreams"][number];
type HubTask = HubWorkstream["tasks"][number];
type HubSubtask = HubTask["subtasks"][number];

/** Texto para comparar títulos: sem acento, sem caixa e sem espaços extras. */
export function normalizeTitle(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export type StructureMatch = {
  /** Para cada marco do arquivo, o do Hub (ou `null`). */
  milestones: (HubMilestone | null)[];
  /** Para cada frente do arquivo, a do Hub (ou `null`). */
  workstreams: (HubWorkstream | null)[];
};

/**
 * Marco pelo código (`## M3 — ...`) ou, sem código, pelo título; frente pelo título,
 * dentro do marco correspondente (ou entre as frentes sem marco).
 */
export function matchStructure(
  file: ParsedPlanFile,
  plan: PlanDto,
): StructureMatch {
  const milestones = file.milestones.map((m) => {
    if (m.code) {
      const byCode = plan.milestones.find((h) => h.code === m.code);
      if (byCode) return byCode;
    }
    const title = normalizeTitle(m.title);
    return (
      plan.milestones.find((h) => normalizeTitle(h.title) === title) ?? null
    );
  });
  const workstreams = file.workstreams.map((w) => {
    const pool =
      w.milestone === null
        ? plan.unplanned.workstreams
        : (milestones[w.milestone]?.workstreams ?? []);
    const title = normalizeTitle(w.title);
    return pool.find((h) => normalizeTitle(h.title) === title) ?? null;
  });
  return { milestones, workstreams };
}

/** Todas as tarefas do plano do Hub, com a tarefa-pai das subtarefas. */
export function hubTasks(plan: PlanDto): Map<string, HubSubtask> {
  const all = new Map<string, HubSubtask>();
  const add = (tasks: HubTask[]) => {
    for (const task of tasks) {
      all.set(task.code, task);
      for (const sub of task.subtasks) all.set(sub.code, sub);
    }
  };
  for (const m of plan.milestones) for (const w of m.workstreams) add(w.tasks);
  for (const w of plan.unplanned.workstreams) add(w.tasks);
  add(plan.unplanned.tasks);
  return all;
}

export type PullOutcome = {
  markdown: string;
  /** Itens do arquivo cuja caixa mudou para ficar igual ao Hub. */
  updated: number;
  /** Tarefas do Hub que entraram no arquivo. */
  inserted: number;
};

const done = (t: { status_category: string }) => t.status_category === "done";
const line = (t: HubSubtask, indent = "") =>
  `${indent}- [${done(t) ? "x" : " "}] ${t.title.replace(/\s+/g, " ").trim()} (${t.code})`;

/**
 * Pull: o estado do Hub vai para o arquivo. Muda as caixas das tarefas e dos critérios de
 * GATE (marco aceito marca todos) e insere as tarefas que faltam: na frente certa, numa
 * frente nova dentro do marco, num marco novo ou na seção "Sem marco".
 */
export function pullIntoFile(file: ParsedPlanFile, plan: PlanDto): PullOutcome {
  const match = matchStructure(file, plan);
  const tasks = hubTasks(plan);
  const crlf =
    file.lines.filter((l) => l.eol === "\r\n").length >
    file.lines.filter((l) => l.eol === "\n").length;
  const eol = crlf ? "\r\n" : "\n";

  // 1) Caixas: tarefas pelo código; critérios pelo texto, no marco correspondente.
  const changes: ItemChange[] = [];
  file.items.forEach((item, index) => {
    if (item.kind === "task") {
      const hub = item.code ? tasks.get(item.code) : undefined;
      if (hub && done(hub) !== item.checked) {
        changes.push({ item: index, checked: done(hub) });
      }
      return;
    }
    const milestone =
      item.milestone === null ? null : match.milestones[item.milestone];
    if (!milestone) return;
    const accepted = milestone.status === "accepted";
    const criterion = milestone.acceptance_criteria.find(
      (c) => normalizeTitle(c.text) === normalizeTitle(item.title),
    );
    if (!criterion && !accepted) return;
    const want = accepted || Boolean(criterion?.done);
    if (want !== item.checked) changes.push({ item: index, checked: want });
  });
  // As mudanças só trocam um caractere por linha: os índices continuam valendo.
  const lines = splitPlanLines(applyItemChanges(file, changes)).map(
    (l) => l.text + l.eol,
  );

  // 2) Inserções, anotadas pela linha depois da qual entram.
  const present = new Set(
    file.items.filter((i) => i.code).map((i) => i.code as string),
  );
  const inserts = new Map<number, string[]>();
  let inserted = 0;
  const put = (after: number, block: string[]) => {
    inserts.set(after, [...(inserts.get(after) ?? []), ...block]);
  };
  const itemsOf = (tasksIn: HubTask[], indent = "") => {
    const out: string[] = [];
    for (const task of tasksIn) {
      out.push(line(task, indent));
      inserted += 1;
      for (const sub of task.subtasks) {
        out.push(line(sub, `${indent}  `));
        inserted += 1;
      }
    }
    return out;
  };

  // Subtarefas que faltam embaixo de uma tarefa que já está no arquivo.
  file.items.forEach((item, index) => {
    if (item.kind !== "task" || item.depth !== 0 || !item.code) return;
    const hub = tasks.get(item.code) as HubTask | undefined;
    const subs = (hub as HubTask | undefined)?.subtasks?.filter(
      (s) => !present.has(s.code),
    );
    if (!subs?.length) return;
    const children = file.items.filter((i) => i.parent === index);
    const after = children.length
      ? Math.max(...children.map((c) => c.lastLine))
      : item.lastLine;
    const indent = /^[ \t]*/.exec(file.lines[item.line].text)![0];
    put(
      after,
      subs.map((s) => {
        inserted += 1;
        return line(s, `${indent}  `);
      }),
    );
  });

  const missing = (w: HubWorkstream) =>
    w.tasks.filter((t) => !present.has(t.code));
  /** Última linha com item numa frente do arquivo (ou o título, sem itens). */
  const endOfItems = (workstream: number) => {
    const own = file.items.filter((i) => i.workstream === workstream);
    return own.length
      ? Math.max(...own.map((i) => i.lastLine))
      : file.workstreams[workstream].line;
  };
  /** Última linha com conteúdo no trecho [from, to]. */
  const lastFilled = (from: number, to: number) => {
    let n = to;
    while (n > from && file.lines[n].text.trim() === "") n -= 1;
    return n;
  };
  const newBlock = (heading: string, body: string[]) => ["", heading, ...body];

  const newSections: string[] = [];
  for (const milestone of plan.milestones) {
    const fm = match.milestones.findIndex((m) => m?.id === milestone.id);
    const pending = milestone.workstreams.filter((w) => missing(w).length > 0);
    if (pending.length === 0) continue;
    if (fm < 0) {
      // Marco que ainda não está no arquivo: seção nova no fim dos marcos.
      newSections.push(
        "",
        `## ${milestone.code} — ${milestone.title}`,
        ...pending.flatMap((w) =>
          newBlock(`### ${w.title}`, itemsOf(missing(w))),
        ),
      );
      continue;
    }
    const section = file.milestones[fm];
    for (const w of pending) {
      const fw = match.workstreams.findIndex((x) => x?.id === w.id);
      if (fw >= 0) {
        put(endOfItems(fw), itemsOf(missing(w)));
        continue;
      }
      // Frente com o nome do marco: itens direto embaixo do `##` (sem `###`).
      if (normalizeTitle(w.title) === normalizeTitle(milestone.title)) {
        const direct = file.items.filter(
          (i) =>
            i.milestone === fm && i.workstream === null && i.kind === "task",
        );
        const after = direct.length
          ? Math.max(...direct.map((i) => i.lastLine))
          : section.line;
        put(after, itemsOf(missing(w)));
        continue;
      }
      // Frente nova no fim do marco, antes do GATE.
      const gate = section.gate === null ? null : file.gates[section.gate];
      const end = gate ? gate.line - 1 : section.end;
      put(
        lastFilled(section.line, end),
        newBlock(`### ${w.title}`, itemsOf(missing(w))),
      );
    }
  }

  // Sem marco: frentes soltas e tarefas sem frente.
  const loose = plan.unplanned.workstreams.filter((w) => missing(w).length);
  const orphans = plan.unplanned.tasks.filter((t) => !present.has(t.code));
  if (loose.length || orphans.length) {
    const blocks: string[] = [];
    for (const w of loose) {
      const fw = match.workstreams.findIndex((x) => x?.id === w.id);
      if (fw >= 0) put(endOfItems(fw), itemsOf(missing(w)));
      else blocks.push(...newBlock(`### ${w.title}`, itemsOf(missing(w))));
    }
    if (orphans.length) {
      blocks.push(...newBlock("### Tarefas sem frente", itemsOf(orphans)));
    }
    if (blocks.length) {
      if (file.unplanned) {
        put(lastFilled(file.unplanned.line, file.unplanned.end), blocks);
      } else {
        newSections.push("", "## Sem marco", ...blocks);
      }
    }
  }

  if (newSections.length) {
    // Depois do último marco do arquivo; sem marcos, antes do registro de execução;
    // senão, no fim.
    const lastMilestone = file.milestones.at(-1);
    const log = file.sections.find((s) =>
      /^(ultimo )?registro\b/.test(normalizeTitle(s.title)),
    );
    const after = lastMilestone
      ? lastFilled(lastMilestone.line, lastMilestone.end)
      : log && log.line > 0
        ? lastFilled(0, log.line - 1)
        : lines.length - 1;
    put(after, newSections);
  }

  // Aplica de baixo para cima, para os índices continuarem valendo.
  const out = lines.slice();
  for (const after of [...inserts.keys()].sort((a, b) => b - a)) {
    const block = inserts.get(after)!;
    const at = after + 1;
    if (after >= 0 && out[after] !== undefined && !/\r?\n$/.test(out[after])) {
      out[after] += eol; // última linha sem quebra
    }
    out.splice(at, 0, ...block.map((b) => b + eol));
  }
  return { markdown: out.join(""), updated: changes.length, inserted };
}
