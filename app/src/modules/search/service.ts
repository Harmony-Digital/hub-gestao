import { z } from "zod";
import { authorize, can } from "@/lib/authorize";
import { badRequest } from "@/lib/errors";
import {
  MilestoneCode,
  ProjectCode,
  StatusCategory,
  TaskCode,
  Uuid,
} from "@/modules/common";
import { projectScopeSql } from "@/modules/common";
import { many, S, type TxCtx } from "@/modules/context";

export const SearchDto = z.object({
  query: z.string(),
  projects: z.array(
    z.object({ code: ProjectCode, name: z.string(), status: z.string() }),
  ),
  tasks: z.array(
    z.object({
      code: TaskCode,
      project_code: ProjectCode,
      title: z.string(),
      status_category: StatusCategory,
    }),
  ),
  milestones: z.array(
    z.object({
      id: Uuid,
      project_code: ProjectCode,
      code: MilestoneCode,
      title: z.string(),
    }),
  ),
  workstreams: z.array(
    z.object({ id: Uuid, project_code: ProjectCode, title: z.string() }),
  ),
});
export type SearchDto = z.infer<typeof SearchDto>;

/** Escapa os curingas do LIKE para buscar o texto como foi digitado. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Busca global no escopo do ator: projetos, tarefas (por código ou título), marcos e frentes. */
export async function search(t: TxCtx, rawQuery: string): Promise<SearchDto> {
  authorize(t.actor, "search");
  const q = rawQuery.trim();
  if (q.length < 2 || q.length > 100) {
    throw badRequest("A busca precisa de 2 a 100 caracteres.");
  }
  const like = likePattern(q);
  const code = q.toUpperCase();

  const pParams: unknown[] = [like, code];
  const projects = await many<{ code: string; name: string; status: string }>(
    t,
    `select p.code, p.name, p.status from ${S}.projects p
      where p.archived_at is null and (p.code = $2 or p.name ilike $1)
        and ${projectScopeSql(t.actor, "p.id", pParams)}
      order by p.code limit 10`,
    pParams,
  );

  let tasks: SearchDto["tasks"] = [];
  if (can(t.actor, "task.read")) {
    const tParams: unknown[] = [like, code];
    tasks = await many<SearchDto["tasks"][number]>(
      t,
      `select t.code, p.code as project_code, t.title, t.status_category
         from ${S}.tasks t join ${S}.projects p on p.id = t.project_id
        where t.archived_at is null and (t.code = $2 or t.title ilike $1)
          and ${projectScopeSql(t.actor, "t.project_id", tParams)}
        order by (t.code = $2) desc, t.updated_at desc limit 20`,
      tParams,
    );
  }

  const mParams: unknown[] = [like];
  const milestones = await many<SearchDto["milestones"][number]>(
    t,
    `select m.id, p.code as project_code, m.code, m.title
       from ${S}.milestones m join ${S}.projects p on p.id = m.project_id
      where m.archived_at is null and m.title ilike $1
        and ${projectScopeSql(t.actor, "m.project_id", mParams)}
      order by p.code, m.sort_order limit 10`,
    mParams,
  );

  const wParams: unknown[] = [like];
  const workstreams = await many<SearchDto["workstreams"][number]>(
    t,
    `select w.id, p.code as project_code, w.title
       from ${S}.workstreams w join ${S}.projects p on p.id = w.project_id
      where w.archived_at is null and w.title ilike $1
        and ${projectScopeSql(t.actor, "w.project_id", wParams)}
      order by p.code, w.sort_order limit 10`,
    wParams,
  );

  return { query: q, projects, tasks, milestones, workstreams };
}
