import { z } from "zod";
import {
  ActorRef,
  IsoDate,
  MilestoneCode,
  Priority,
  ProjectCode,
  StatusCategory,
  TaskCode,
  Timestamp,
  Uuid,
  Visibility,
} from "@/modules/common";

export const ProjectStatus = z.enum([
  "in_review",
  "discovery",
  "active",
  "paused",
  "delivered",
  "archived",
]);
export const ProjectPhase = z.enum(["descobrir", "validar", "escalar"]);
export const ProjectHealth = z.enum(["healthy", "attention", "at_risk"]);

export const ProjectSummary = z.object({
  id: Uuid,
  code: ProjectCode,
  name: z.string(),
  client: z.object({ id: Uuid, slug: z.string(), name: z.string() }),
  status: ProjectStatus,
  phase: ProjectPhase,
  health: ProjectHealth,
  progress_pct: z.number().int(),
  task_count: z.number().int(),
  open_task_count: z.number().int(),
  blocked_task_count: z.number().int(),
  start_date: IsoDate.nullable(),
  target_date: IsoDate.nullable(),
  repo_url: z.string().nullable(),
  plan_path: z.string().nullable(),
  updated_at: Timestamp,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const MilestoneStatus = z.enum([
  "planned",
  "in_progress",
  "delivered",
  "accepted",
]);
export const AcceptanceCriterion = z.object({
  text: z.string(),
  done: z.boolean(),
});

export const MilestoneDto = z.object({
  id: Uuid,
  project_code: ProjectCode,
  code: MilestoneCode,
  title: z.string(),
  title_client: z.string().nullable(),
  description_client: z.string().nullable(),
  due_date: IsoDate.nullable(),
  sort_order: z.number().int(),
  gate_required: z.boolean(),
  status: MilestoneStatus,
  late: z.boolean().describe("Data passou sem entrega (derivado)."),
  visibility: Visibility,
  acceptance_criteria: z.array(AcceptanceCriterion),
  progress_pct: z.number().int(),
  task_count: z.number().int(),
  done_count: z.number().int(),
  delivered_at: Timestamp.nullable(),
  accepted_at: Timestamp.nullable(),
  accepted_by: ActorRef.nullable(),
  client_received_at: Timestamp.nullable().describe(
    "Quando o cliente confirmou no portal que recebeu a entrega (opção do projeto). Não é o aceite, que é do dono (D9).",
  ),
  client_received_by: z
    .string()
    .nullable()
    .describe("Nome do contato do cliente que confirmou o recebimento."),
});
export type MilestoneDto = z.infer<typeof MilestoneDto>;

export const WorkstreamStatus = z.enum([
  "planned",
  "in_progress",
  "blocked",
  "done",
]);

export const WorkstreamDto = z.object({
  id: Uuid,
  project_code: ProjectCode,
  milestone: z.object({ id: Uuid, code: MilestoneCode }).nullable(),
  department: z
    .object({ slug: z.string(), name: z.string(), color: z.string() })
    .nullable(),
  title: z.string(),
  title_client: z.string().nullable(),
  description_internal: z.string().nullable(),
  description_client: z.string().nullable(),
  visibility: Visibility,
  status: WorkstreamStatus,
  sort_order: z.number().int(),
  assignee: ActorRef.nullable(),
  progress_pct: z.number().int(),
  task_count: z.number().int(),
  done_count: z.number().int(),
  blocked_count: z.number().int(),
  depends_on: z
    .array(Uuid)
    .describe(
      "Frentes ativas de que esta depende (ids), na ordem das frentes.",
    ),
  updated_at: Timestamp,
});
export type WorkstreamDto = z.infer<typeof WorkstreamDto>;

export const ProjectDetail = ProjectSummary.extend({
  objective_internal: z.string().nullable(),
  objective_client: z.string().nullable(),
  health_reason: z.record(z.string(), z.unknown()),
  require_evidence: z.boolean(),
  client_can_confirm_receipt: z.boolean(),
  owner: ActorRef.nullable(),
  pm_agent: ActorRef.nullable(),
  departments: z.array(z.object({ slug: z.string(), name: z.string() })),
  next_milestones: z.array(MilestoneDto),
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

export const ProjectList = z.object({ items: z.array(ProjectSummary) });

/** Tarefa resumida, como aparece na árvore do plano e na fila do dia. */
export const TaskSummary = z.object({
  code: TaskCode,
  project_code: ProjectCode,
  title: z.string(),
  status_name: z.string(),
  status_category: StatusCategory,
  priority: Priority,
  assignee: ActorRef.nullable(),
  due_date: IsoDate.nullable(),
  blocked_reason: z.string().nullable(),
  blocked_on: ActorRef.nullable(),
  parent_code: TaskCode.nullable(),
});
export type TaskSummary = z.infer<typeof TaskSummary>;

export const PlanTask = TaskSummary.extend({
  subtasks: z.array(TaskSummary),
});

export const PlanWorkstream = WorkstreamDto.extend({
  tasks: z.array(PlanTask),
});

export const PlanDto = z.object({
  project: ProjectSummary,
  milestones: z.array(
    MilestoneDto.extend({ workstreams: z.array(PlanWorkstream) }),
  ),
  unplanned: z.object({
    workstreams: z.array(PlanWorkstream),
    tasks: z.array(PlanTask),
  }),
});
export type PlanDto = z.infer<typeof PlanDto>;

export const HealthDto = z.object({
  project_code: ProjectCode,
  health: ProjectHealth,
  reasons: z.array(z.string()),
  inputs: z.object({
    open_task_count: z.number().int(),
    blocked_task_count: z.number().int(),
    late_milestones: z.number().int(),
    broken_dependencies: z
      .number()
      .int()
      .describe(
        "Frentes que começaram antes de terminar a frente de que dependem.",
      ),
    next_due_date: IsoDate.nullable(),
    oldest_pending_approval_at: Timestamp.nullable(),
  }),
  stored_health: ProjectHealth,
});
export type HealthDto = z.infer<typeof HealthDto>;
