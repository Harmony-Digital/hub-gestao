import { z } from "zod";
import { audit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import {
  ActorRef,
  actorRef,
  authorizeProjectId,
  iso,
  IsoDate,
  TaskCode,
  Timestamp,
  Uuid,
} from "@/modules/common";
import { maybeOne, S, type TxCtx } from "@/modules/context";

export const LogTimeInput = z.strictObject({
  minutes: z.number().int().min(1).max(1440),
  entry_date: IsoDate.optional().describe("Dia do trabalho; padrão: hoje."),
  note: z.string().trim().max(500).optional(),
});
export type LogTimeInput = z.infer<typeof LogTimeInput>;

export const TimeEntryDto = z.object({
  id: Uuid,
  task_code: TaskCode,
  minutes: z.number().int(),
  entry_date: IsoDate,
  note: z.string().nullable(),
  actor: ActorRef,
  created_at: Timestamp,
});
export type TimeEntryDto = z.infer<typeof TimeEntryDto>;

export async function logTime(
  t: TxCtx,
  code: string,
  input: LogTimeInput,
): Promise<TimeEntryDto> {
  const parsed = TaskCode.safeParse(code);
  if (!parsed.success)
    throw badRequest("Código de tarefa inválido: use o formato HUB-123.");
  const task = await maybeOne<{ id: string; code: string; project_id: string }>(
    t,
    `select id, code, project_id from ${S}.tasks where code = $1 and archived_at is null`,
    [parsed.data],
  );
  if (!task)
    throw notFound(`Tarefa ${parsed.data} não encontrada neste workspace.`);
  await authorizeProjectId(t, task.project_id, "time.write");
  assertNoSecrets({ note: input.note });
  const row = await maybeOne<{
    id: string;
    minutes: number;
    entry_date: string;
    note: string | null;
    created_at: Date | string;
  }>(
    t,
    `insert into ${S}.time_entries (workspace_id, task_id, actor_type, actor_id, minutes, entry_date, note)
     values ($1, $2, $3, $4, $5, coalesce($6::date, current_date), $7)
     returning id, minutes, entry_date, note, created_at`,
    [
      t.actor.workspaceId,
      task.id,
      t.actor.type,
      t.actor.id,
      input.minutes,
      input.entry_date ?? null,
      input.note ?? null,
    ],
  );
  await audit(t, {
    action: "time.logged",
    entityType: "task",
    entityId: task.id,
    projectId: task.project_id,
    after: { minutes: input.minutes, entry_date: row!.entry_date },
  });
  return {
    id: row!.id,
    task_code: task.code,
    minutes: row!.minutes,
    entry_date: row!.entry_date,
    note: row!.note,
    actor: actorRef(t.actor.type, t.actor.id, t.actor.name)!,
    created_at: iso(row!.created_at),
  };
}
