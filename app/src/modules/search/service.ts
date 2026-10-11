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
  people: z
    .array(
      z.object({
        id: Uuid,
        name: z.string(),
        role: z.enum(["owner", "admin", "member"]),
      }),
    )
    .describe(
      'Pessoas da equipe pelo nome, só nome e papel (para atribuir: assignee { type: "user", id }).',
    ),
  agents: z
    .array(
      z.object({
        id: Uuid,
        name: z.string(),
        status: z.enum(["active", "paused"]),
        department: z.string().nullable(),
      }),
    )
    .describe(
      'Agentes do workspace pelo nome (para atribuir: assignee { type: "agent", id }).',
    ),
});
export type SearchDto = z.infer<typeof SearchDto>;

/** Letras com acento e as mesmas sem acento, na mesma ordem (para o translate do SQL). */
const ACCENTED = "áàâãäéèêëíìîïóòôõöúùûüçñ";
const PLAIN = "aaaaaeeeeiiiiooooouuuucn";

/**
 * O texto da coluna em minúsculas e sem acento, para "reuniao" achar "Reunião" e "fabio"
 * achar "Fábio". Feito com translate, que vale no Postgres e no banco local, sem extensão.
 */
function folded(column: string): string {
  return `translate(lower(${column}), '${ACCENTED}', '${PLAIN}')`;
}

/** O que foi digitado, sem acento e em minúsculas, com os curingas do LIKE escapados. */
function likePattern(q: string): string {
  const plain = q
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return `%${plain.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Busca global no escopo do ator: projetos, tarefas (por código ou título), marcos,
 * frentes, pessoas da equipe e agentes (RF-38). Pessoas e agentes valem para quem vê os
 * agentes (a equipe e os agentes, para poder atribuir); de pessoa, só o nome e o papel,
 * nunca o e-mail, e a busca é só pelo nome.
 */
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
      where p.archived_at is null and (p.code = $2 or ${folded("p.name")} like $1)
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
        where t.archived_at is null and (t.code = $2 or ${folded("t.title")} like $1)
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
      where m.archived_at is null and ${folded("m.title")} like $1
        and ${projectScopeSql(t.actor, "m.project_id", mParams)}
      order by p.code, m.sort_order limit 10`,
    mParams,
  );

  const wParams: unknown[] = [like];
  const workstreams = await many<SearchDto["workstreams"][number]>(
    t,
    `select w.id, p.code as project_code, w.title
       from ${S}.workstreams w join ${S}.projects p on p.id = w.project_id
      where w.archived_at is null and ${folded("w.title")} like $1
        and ${projectScopeSql(t.actor, "w.project_id", wParams)}
      order by p.code, w.sort_order limit 10`,
    wParams,
  );

  let people: SearchDto["people"] = [];
  let agents: SearchDto["agents"] = [];
  if (can(t.actor, "agent.read")) {
    people = await many<SearchDto["people"][number]>(
      t,
      `select p.id, p.full_name as name, m.role::text as role
         from ${S}.memberships m join ${S}.profiles p on p.id = m.profile_id
        where m.status = 'active' and ${folded("p.full_name")} like $1
        order by p.full_name limit 10`,
      [like],
    );
    agents = await many<SearchDto["agents"][number]>(
      t,
      `select a.id, a.name, a.status::text as status, d.name as department
         from ${S}.agents a left join ${S}.departments d on d.id = a.department_id
        where a.status <> 'revoked' and ${folded("a.name")} like $1
        order by a.name limit 10`,
      [like],
    );
  }

  return { query: q, projects, tasks, milestones, workstreams, people, agents };
}
