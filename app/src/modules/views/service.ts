import { badRequest, notFound, unprocessable } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import { iso, Line, resolveProject, Uuid } from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Visões salvas por pessoa (Lista e Quadro de um projeto): um nome e os filtros do
 * endereço. Cada um vê só as próprias; agentes filtram pela API.
 */

export type ViewType = "list" | "board";

export type SavedViewDto = {
  id: string;
  name: string;
  type: ViewType;
  /** Parâmetros do endereço, já normalizados pela tela (ex.: "resp=eu&prio=urgent"). */
  query: string;
  created_at: string;
};

const MAX_VIEWS = 20;

function me(t: TxCtx): string {
  if (t.actor.type !== "user") {
    throw badRequest("Visões salvas são de pessoas.");
  }
  return t.actor.id;
}

export async function listSavedViews(
  t: TxCtx,
  projectId: string,
  type: ViewType,
): Promise<SavedViewDto[]> {
  if (t.actor.type !== "user") return [];
  const rows = await many<{
    id: string;
    name: string;
    type: ViewType;
    config: { query?: unknown };
    created_at: Date | string;
  }>(
    t,
    `select id, name, type, config, created_at from ${S}.saved_views
      where profile_id = $1 and project_id = $2 and type = $3
      order by name`,
    [t.actor.id, projectId, type],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    query: typeof r.config?.query === "string" ? r.config.query : "",
    created_at: iso(r.created_at),
  }));
}

export async function saveView(
  t: TxCtx,
  projectCode: string,
  input: { type: ViewType; name: string; query: string },
): Promise<SavedViewDto> {
  const profile = me(t);
  const project = await resolveProject(t, projectCode, "project.read");
  const name = Line(60).safeParse(input.name);
  if (!name.success) {
    throw badRequest("Dê um nome de até 60 caracteres à visão.");
  }
  if (input.query.length > 600) {
    throw unprocessable("Filtros demais para uma visão. Simplifique.");
  }
  assertNoSecrets({ name: name.data });
  const count = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.saved_views where profile_id = $1 and project_id = $2`,
    [profile, project.id],
  );
  if (count!.n >= MAX_VIEWS) {
    throw unprocessable(
      `Você já tem ${MAX_VIEWS} visões neste projeto. Apague alguma antes.`,
    );
  }
  const row = await maybeOne<{ id: string; created_at: Date | string }>(
    t,
    `insert into ${S}.saved_views (workspace_id, profile_id, project_id, type, name, config)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     returning id, created_at`,
    [
      t.actor.workspaceId,
      profile,
      project.id,
      input.type,
      name.data,
      json({ query: input.query }),
    ],
  );
  return {
    id: row!.id,
    name: name.data,
    type: input.type,
    query: input.query,
    created_at: iso(row!.created_at),
  };
}

export async function deleteView(t: TxCtx, id: string): Promise<void> {
  const profile = me(t);
  if (!Uuid.safeParse(id).success) throw badRequest("Visão inválida.");
  const row = await maybeOne<{ id: string }>(
    t,
    `delete from ${S}.saved_views where id = $1 and profile_id = $2 returning id`,
    [id, profile],
  );
  if (!row) throw notFound("Visão não encontrada.");
}
