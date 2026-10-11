import { z } from "zod";
import { authorize } from "@/lib/authorize";
import { unprocessable } from "@/lib/errors";
import {
  ACTOR_NAME_SQL,
  iso,
  IsoDate,
  ProjectCode,
  resolveProject,
  Timestamp,
} from "@/modules/common";
import { many, S, type TxCtx } from "@/modules/context";
import { describeActivity } from "@/modules/projects/overview";

/**
 * Exportação da atividade por período (RF-43): o registro de atividades (append-only) de
 * um projeto, ou de todos (dono e administração), pronto para ler: quando, quem, em que
 * papel, por onde, a ação em PT-BR, a tarefa e o detalhe gravado. Em JSON ou em CSV.
 */

export const MAX_DAYS = 366;
export const MAX_ROWS = 50_000;

export const ActivityExportInput = z.strictObject({
  project: ProjectCode.optional().describe(
    "Código do projeto. Sem projeto, a atividade de todos (só dono e administração).",
  ),
  from: IsoDate.describe("Primeiro dia (AAAA-MM-DD), no fuso do workspace."),
  to: IsoDate.describe("Último dia (AAAA-MM-DD), incluído."),
});
export type ActivityExportInput = z.infer<typeof ActivityExportInput>;

export const ActivityRow = z.object({
  at: Timestamp,
  project_code: ProjectCode.nullable(),
  actor_type: z.enum(["user", "agent", "system"]),
  actor_name: z.string().nullable(),
  acting_role: z
    .string()
    .nullable()
    .describe("Papel declarado na escrita (AGENTES.md), como GP-01."),
  source: z.string().describe("Por onde veio: ui, api, mcp, sync, cron..."),
  action: z.string().describe("Código da ação, como task.completed."),
  description: z.string().describe("A ação em PT-BR, como “concluiu HUB-12”."),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  task_code: z.string().nullable(),
  detail: z
    .unknown()
    .nullable()
    .describe(
      "O que a ação gravou (o `after` do registro), como está no banco.",
    ),
});
export type ActivityRow = z.infer<typeof ActivityRow>;

export const ActivityExport = z.object({
  project_code: ProjectCode.nullable(),
  from: IsoDate,
  to: IsoDate,
  items: z.array(ActivityRow),
});
export type ActivityExport = z.infer<typeof ActivityExport>;

const DAY = 86_400_000;

export async function exportActivity(
  t: TxCtx,
  input: ActivityExportInput,
): Promise<ActivityExport> {
  const project = input.project
    ? await resolveProject(t, input.project, "project.read")
    : null;
  // A atividade de todos os projetos (e a do workspace) é do dono e da administração.
  if (!project) authorize(t.actor, "workspace.admin");
  if (input.to < input.from) {
    throw unprocessable("O último dia não pode ser antes do primeiro.");
  }
  const days =
    (Date.parse(`${input.to}T00:00:00Z`) -
      Date.parse(`${input.from}T00:00:00Z`)) /
      DAY +
    1;
  if (days > MAX_DAYS) {
    throw unprocessable(
      `Período de até ${MAX_DAYS} dias: divida a exportação.`,
    );
  }
  const rows = await many<{
    created_at: Date | string;
    project_code: string | null;
    actor_type: "user" | "agent" | "system";
    actor_name: string | null;
    acting_role: string | null;
    source: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    task_code: string | null;
    after: unknown;
  }>(
    t,
    `select a.created_at, p.code as project_code, a.actor_type::text as actor_type,
            ${ACTOR_NAME_SQL("a.actor_type::text", "a.actor_id")} as actor_name,
            a.acting_role, a.source, a.action, a.entity_type, a.entity_id::text as entity_id,
            coalesce(tk.code, tkc.code) as task_code, a.after
       from ${S}.activity_log a
       left join ${S}.projects p on p.id = a.project_id
       left join ${S}.tasks tk on a.entity_type = 'task' and tk.id = a.entity_id
       left join ${S}.comments cm on a.entity_type = 'comment' and cm.id = a.entity_id
       left join ${S}.tasks tkc on cm.entity_type = 'task' and tkc.id = cm.entity_id
      where ($1::uuid is null or a.project_id = $1)
        and a.created_at >= $2::date::timestamptz
        and a.created_at < ($3::date + 1)::timestamptz
      order by a.id
      limit ${MAX_ROWS + 1}`,
    [project?.id ?? null, input.from, input.to],
  );
  if (rows.length > MAX_ROWS) {
    throw unprocessable(
      `O período tem mais de ${MAX_ROWS.toLocaleString("pt-BR")} registros: divida a exportação.`,
    );
  }
  return {
    project_code: project?.code ?? null,
    from: input.from,
    to: input.to,
    items: rows.map((r) => ({
      at: iso(r.created_at),
      project_code: r.project_code,
      actor_type: r.actor_type,
      actor_name: r.actor_name,
      acting_role: r.acting_role,
      source: r.source,
      action: r.action,
      description: describeActivity(r.action, r.task_code),
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      task_code: r.task_code,
      detail: r.after ?? null,
    })),
  };
}

const CSV_COLUMNS: [keyof ActivityRow, string][] = [
  ["at", "quando"],
  ["project_code", "projeto"],
  ["actor_type", "tipo de ator"],
  ["actor_name", "quem"],
  ["acting_role", "papel"],
  ["source", "origem"],
  ["action", "ação"],
  ["description", "descrição"],
  ["task_code", "tarefa"],
  ["entity_type", "entidade"],
  ["entity_id", "id da entidade"],
  ["detail", "detalhe"],
];

/** Célula do CSV: aspas quando precisa, com as aspas internas dobradas. */
function cell(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV com ponto e vírgula e o BOM do UTF-8: abre direto no Excel em português (que usa a
 * vírgula como separador decimal) com os acentos certos.
 */
export function activityCsv(rows: ActivityRow[]): string {
  const lines = [
    CSV_COLUMNS.map(([, label]) => cell(label)).join(";"),
    ...rows.map((r) => CSV_COLUMNS.map(([key]) => cell(r[key])).join(";")),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
