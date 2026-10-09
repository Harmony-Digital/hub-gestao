import { z } from "zod";
import {
  ActorRef,
  IsoDate,
  Priority,
  ProjectCode,
  StatusCategory,
  TaskCode,
  Text,
  Timestamp,
  Uuid,
} from "@/modules/common";

export const AssigneeInput = z.union([
  z.literal("me"),
  z.strictObject({ type: z.enum(["user", "agent"]), id: Uuid }),
]);
export type AssigneeInput = z.infer<typeof AssigneeInput>;

export const TaskDto = z.object({
  id: Uuid,
  code: TaskCode,
  project_code: ProjectCode,
  title: z.string(),
  description_md: z.string().nullable(),
  status: z.object({
    id: Uuid,
    name: z.string(),
    category: StatusCategory,
    color: z.string(),
  }),
  priority: Priority,
  assignee: ActorRef.nullable(),
  workstream: z.object({ id: Uuid, title: z.string() }).nullable(),
  parent_code: TaskCode.nullable(),
  start_date: IsoDate.nullable(),
  due_date: IsoDate.nullable(),
  estimate_minutes: z.number().int().nullable(),
  sort_key: z.number(),
  source: z.string(),
  external_ref: z.string().nullable(),
  done_evidence: z.string().nullable(),
  blocked_reason: z.string().nullable(),
  completed_at: Timestamp.nullable(),
  completed_by: ActorRef.nullable(),
  created_by: ActorRef,
  version: z.number().int(),
  created_at: Timestamp,
  updated_at: Timestamp,
  archived_at: Timestamp.nullable(),
});
export type TaskDto = z.infer<typeof TaskDto>;

export const TaskPage = z.object({
  items: z.array(TaskDto),
  next_cursor: z.string().nullable(),
});

/** Filtros da listagem (iguais na REST e no MCP). */
export const TaskFilter = z.strictObject({
  project: ProjectCode.optional(),
  assignee: z
    .union([
      z.literal("me"),
      z.literal("none"),
      z.string().regex(/^(user|agent):[0-9a-f-]{36}$/),
    ])
    .optional()
    .describe('"me", "none" ou "agent:<uuid>" / "user:<uuid>"'),
  status_category: z.array(StatusCategory).optional(),
  due_before: IsoDate.optional(),
  blocked: z.boolean().optional(),
  workstream_id: Uuid.optional(),
  parent: TaskCode.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export type TaskFilter = z.infer<typeof TaskFilter>;

export const CreateTaskInput = z.strictObject({
  project: ProjectCode,
  title: Text(300),
  description_md: z.string().max(20000).optional(),
  workstream_id: Uuid.optional(),
  parent: TaskCode.optional().describe("Código da tarefa-pai (subtarefa)."),
  priority: Priority.optional(),
  assignee: AssigneeInput.optional(),
  start_date: IsoDate.optional(),
  due_date: IsoDate.optional(),
  estimate_minutes: z.number().int().min(1).max(100000).optional(),
  external_ref: z.string().trim().max(500).optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const UpdateTaskInput = z.strictObject({
  title: Text(300).optional(),
  description_md: z.string().max(20000).nullable().optional(),
  priority: Priority.optional(),
  assignee: AssigneeInput.nullable().optional(),
  start_date: IsoDate.nullable().optional(),
  due_date: IsoDate.nullable().optional(),
  estimate_minutes: z.number().int().min(1).max(100000).nullable().optional(),
  workstream_id: Uuid.nullable().optional(),
  status: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .optional()
    .describe(
      "Nome de um status do projeto nas categorias A fazer, Em andamento ou Em revisão. Para bloquear ou concluir, use as ações próprias.",
    ),
  sort_key: z.number().finite().optional(),
  external_ref: z.string().trim().max(500).nullable().optional(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;

export const BlockTaskInput = z.strictObject({
  reason: Text(2000).describe("O que falta e de quem depende."),
});
export const CompleteTaskInput = z.strictObject({
  evidence: Text(2000).describe(
    "Prova verificável: SHA do commit, URL, arquivo ou teste.",
  ),
});
export const ReopenTaskInput = z.strictObject({
  reason: Text(2000).optional(),
});
