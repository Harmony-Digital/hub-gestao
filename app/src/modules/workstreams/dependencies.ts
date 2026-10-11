import { audit } from "@/lib/audit";
import { badRequest, unprocessable } from "@/lib/errors";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { dependencyAlerts, type DependencyAlert } from "./dependency-rule";

/**
 * Dependências entre frentes (RF-13), a parte do banco. A lista de uma frente é gravada
 * inteira (substitui a anterior), só com frentes ativas do mesmo projeto, sem ela mesma e
 * sem fechar ciclo. Ligação com frente arquivada fica guardada e volta com a restauração.
 * Quem chama já conferiu a escrita da frente (workstream.write).
 */

export const MAX_WORKSTREAM_DEPENDENCIES = 20;

/** Frentes ativas de que cada frente do projeto depende (ids), para o DTO. */
export const DEPENDS_ON_SQL = `
  coalesce((select array_agg(d.depends_on_id::text order by dw.sort_order, dw.title)
              from ${S}.workstream_dependencies d
              join ${S}.workstreams dw on dw.id = d.depends_on_id and dw.archived_at is null
             where d.workstream_id = w.id), '{}')`;

/** Grava a lista de dependências da frente. Devolve se algo mudou. */
export async function replaceWorkstreamDependencies(
  t: TxCtx,
  workstream: { id: string; project_id: string },
  dependsOn: string[],
): Promise<boolean> {
  const wanted = [...new Set(dependsOn)];
  if (wanted.includes(workstream.id)) {
    throw badRequest("A frente não pode depender de si mesma.");
  }
  if (wanted.length > MAX_WORKSTREAM_DEPENDENCIES) {
    throw unprocessable(
      `Uma frente depende de no máximo ${MAX_WORKSTREAM_DEPENDENCIES} frentes.`,
    );
  }
  const found = await many<{ id: string; title: string }>(
    t,
    `select id::text as id, title from ${S}.workstreams
      where id = any($1::uuid[]) and project_id = $2 and archived_at is null`,
    [wanted, workstream.project_id],
  );
  if (found.length !== wanted.length) {
    throw unprocessable(
      "A frente só pode depender de frentes ativas do mesmo projeto.",
    );
  }
  const current = await many<{ id: string; title: string }>(
    t,
    `select dw.id::text as id, dw.title
       from ${S}.workstream_dependencies d
       join ${S}.workstreams dw on dw.id = d.depends_on_id and dw.archived_at is null
      where d.workstream_id = $1
      order by dw.sort_order, dw.title`,
    [workstream.id],
  );
  const same =
    current.length === wanted.length &&
    current.every((c) => wanted.includes(c.id));
  if (same) return false;

  // Ciclo: alguma das escolhidas já depende (direta ou indiretamente) desta frente.
  const cycle = await maybeOne<{ origin: string }>(
    t,
    `with recursive reach(origin, id) as (
       select d.workstream_id, d.depends_on_id
         from ${S}.workstream_dependencies d
        where d.workstream_id = any($1::uuid[])
       union
       select r.origin, d.depends_on_id
         from ${S}.workstream_dependencies d join reach r on d.workstream_id = r.id
     )
     select origin::text as origin from reach where id = $2 limit 1`,
    [wanted, workstream.id],
  );
  if (cycle) {
    const title = found.find((f) => f.id === cycle.origin)?.title ?? "";
    throw unprocessable(
      `“${title}” já depende desta frente (direta ou indiretamente): a ligação fecharia um ciclo.`,
    );
  }

  await t.tx.query(
    `delete from ${S}.workstream_dependencies d
      using ${S}.workstreams dw
      where d.workstream_id = $1 and dw.id = d.depends_on_id
        and dw.archived_at is null and not (d.depends_on_id = any($2::uuid[]))`,
    [workstream.id, wanted],
  );
  await t.tx.query(
    `insert into ${S}.workstream_dependencies (workspace_id, workstream_id, depends_on_id)
     select $1, $2, unnest($3::uuid[])
     on conflict do nothing`,
    [t.actor.workspaceId, workstream.id, wanted],
  );
  const titles = (list: { title: string }[]) =>
    list.map((x) => x.title).sort((a, b) => a.localeCompare(b, "pt-BR"));
  await audit(t, {
    action: "workstream.dependencies_changed",
    entityType: "workstream",
    entityId: workstream.id,
    projectId: workstream.project_id,
    before: { depends_on: titles(current) },
    after: { depends_on: titles(found) },
  });
  return true;
}

/**
 * Alertas de dependência do projeto: frentes que começaram antes de terminar a frente de
 * que dependem. Quem chama já conferiu a leitura do projeto.
 */
export async function dependencyAlertsOf(
  t: TxCtx,
  projectId: string,
): Promise<DependencyAlert[]> {
  const rows = await many<{
    id: string;
    title: string;
    status: "planned" | "in_progress" | "blocked" | "done";
    tasks_started: boolean;
    depends_on: string[];
  }>(
    t,
    `select w.id::text as id, w.title, w.status::text as status,
            exists (select 1 from ${S}.tasks tk
                     where tk.workstream_id = w.id and tk.archived_at is null
                       and tk.status_category <> 'todo') as tasks_started,
            coalesce((select array_agg(d.depends_on_id::text)
                        from ${S}.workstream_dependencies d
                       where d.workstream_id = w.id), '{}') as depends_on
       from ${S}.workstreams w
      where w.project_id = $1 and w.archived_at is null
      order by w.sort_order, w.title`,
    [projectId],
  );
  return dependencyAlerts(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      tasksStarted: r.tasks_started,
      dependsOn: r.depends_on ?? [],
    })),
  );
}
