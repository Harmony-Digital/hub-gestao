import { z } from "zod";
import { audit } from "@/lib/audit";
import { conflict, notFound, unprocessable, badRequest } from "@/lib/errors";
import {
  authorizeProjectId,
  Line,
  resolveProject,
  Uuid,
} from "@/modules/common";
import { json, many, maybeOne, S, type TxCtx } from "@/modules/context";
import {
  CUSTOM_FIELD_KINDS,
  MAX_FIELDS,
  MAX_OPTIONS,
  normalizeFieldValue,
  type CustomFieldKind,
} from "./custom-field-kinds";

/**
 * Campos personalizados das tarefas (RF-19, M7): cada projeto define os seus (texto,
 * número, seleção, data ou URL), e cada tarefa guarda o valor. Definir, renomear e tirar
 * campo é do dono e da administração; o valor é de quem escreve na tarefa (task.write),
 * pela mesma atualização da tarefa (`custom_fields`, pelo nome do campo). Interno: o
 * cliente nunca vê.
 */

const ADMIN = "workspace.admin" as const;

export const CustomFieldDto = z.object({
  id: Uuid,
  name: z.string(),
  kind: z.enum(CUSTOM_FIELD_KINDS),
  options: z
    .array(z.string())
    .describe("Opções da seleção, na ordem; vazio nos outros tipos."),
});
export type CustomFieldDto = z.infer<typeof CustomFieldDto>;

export const CustomFieldList = z.object({ items: z.array(CustomFieldDto) });

export const CustomFieldInput = z.strictObject({
  name: Line(60),
  kind: z.enum(CUSTOM_FIELD_KINDS),
  options: z.array(Line(60)).max(MAX_OPTIONS).default([]),
});
export type CustomFieldInput = z.infer<typeof CustomFieldInput>;

type FieldRow = {
  id: string;
  project_id: string;
  name: string;
  kind: CustomFieldKind;
  options: unknown;
};

const toDto = (r: FieldRow): CustomFieldDto => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  options: Array.isArray(r.options)
    ? r.options.filter((o): o is string => typeof o === "string")
    : [],
});

/** Os campos do projeto, na ordem. Quem chama já conferiu a leitura do projeto. */
export async function projectFields(
  t: TxCtx,
  projectId: string,
): Promise<CustomFieldDto[]> {
  const rows = await many<FieldRow>(
    t,
    `select id, project_id, name, kind::text as kind, options
       from ${S}.custom_fields where project_id = $1
      order by sort_order, created_at`,
    [projectId],
  );
  return rows.map(toDto);
}

/** Os campos do projeto, para quem lê as tarefas (o cliente nunca: é camada operacional). */
export async function listProjectFields(
  t: TxCtx,
  code: string,
): Promise<CustomFieldDto[]> {
  const project = await resolveProject(t, code, "task.read");
  return projectFields(t, project.id);
}

function cleanOptions(input: CustomFieldInput): string[] {
  const options = [...new Set(input.options.map((o) => o.trim()))].filter(
    Boolean,
  );
  if (input.kind === "select" && options.length === 0) {
    throw unprocessable("Campo de seleção precisa de pelo menos uma opção.");
  }
  return input.kind === "select" ? options : [];
}

async function nameTaken(
  t: TxCtx,
  projectId: string,
  name: string,
  except: string | null,
) {
  const row = await maybeOne<{ id: string }>(
    t,
    `select id from ${S}.custom_fields
      where project_id = $1 and lower(name) = lower($2) and ($3::uuid is null or id <> $3)`,
    [projectId, name, except],
  );
  if (row) throw conflict(`O projeto já tem um campo chamado “${name}”.`);
}

export async function createField(
  t: TxCtx,
  code: string,
  input: CustomFieldInput,
): Promise<CustomFieldDto> {
  const project = await resolveProject(t, code, ADMIN);
  const options = cleanOptions(input);
  const count = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.custom_fields where project_id = $1`,
    [project.id],
  );
  if ((count?.n ?? 0) >= MAX_FIELDS) {
    throw unprocessable(`Até ${MAX_FIELDS} campos por projeto.`);
  }
  await nameTaken(t, project.id, input.name, null);
  const row = await maybeOne<FieldRow>(
    t,
    `insert into ${S}.custom_fields (workspace_id, project_id, name, kind, options, sort_order)
     values ($1, $2, $3, $4, $5::jsonb,
             coalesce((select max(sort_order) + 1 from ${S}.custom_fields where project_id = $2), 0))
     returning id, project_id, name, kind::text as kind, options`,
    [t.actor.workspaceId, project.id, input.name, input.kind, json(options)],
  );
  await audit(t, {
    action: "custom_field.created",
    entityType: "project",
    entityId: project.id,
    projectId: project.id,
    after: { name: input.name, kind: input.kind, options },
  });
  return toDto(row!);
}

async function lockField(t: TxCtx, id: string): Promise<FieldRow> {
  if (!Uuid.safeParse(id).success) throw badRequest("Campo inválido.");
  const row = await maybeOne<FieldRow>(
    t,
    `select id, project_id, name, kind::text as kind, options
       from ${S}.custom_fields where id = $1 for update`,
    [id],
  );
  if (!row) throw notFound("Campo não encontrado neste workspace.");
  await authorizeProjectId(t, row.project_id, ADMIN);
  return row;
}

/** Renomeia e, na seleção, troca as opções. O tipo não muda depois de criado. */
export async function updateField(
  t: TxCtx,
  id: string,
  input: { name: string; options: string[] },
): Promise<CustomFieldDto> {
  const current = await lockField(t, id);
  const parsed = CustomFieldInput.parse({
    name: input.name,
    kind: current.kind,
    options: input.options,
  });
  const options = cleanOptions(parsed);
  await nameTaken(t, current.project_id, parsed.name, current.id);
  if (current.kind === "select") {
    // Opção que sai e ainda está em uso: troque nas tarefas antes.
    const inUse = await many<{ value: string; n: number }>(
      t,
      `select value, count(*)::int as n from ${S}.custom_field_values
        where field_id = $1 and not (value = any($2::text[]))
        group by value order by value`,
      [current.id, options],
    );
    if (inUse.length > 0) {
      throw unprocessable(
        `A opção ${inUse.map((u) => `“${u.value}” (${u.n === 1 ? "1 tarefa" : `${u.n} tarefas`})`).join(", ")} ainda está em uso: troque nas tarefas antes de tirar.`,
      );
    }
  }
  await t.tx.query(
    `update ${S}.custom_fields set name = $2, options = $3::jsonb where id = $1`,
    [current.id, parsed.name, json(options)],
  );
  const before = toDto(current);
  await audit(t, {
    action: "custom_field.updated",
    entityType: "project",
    entityId: current.project_id,
    projectId: current.project_id,
    before: { name: before.name, options: before.options },
    after: { name: parsed.name, options },
  });
  return { ...before, name: parsed.name, options };
}

/** Tira o campo do projeto, com os valores dele nas tarefas (o histórico guarda). */
export async function removeField(
  t: TxCtx,
  id: string,
): Promise<{ name: string; values: number }> {
  const current = await lockField(t, id);
  const values = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.custom_field_values where field_id = $1`,
    [current.id],
  );
  await t.tx.query(`delete from ${S}.custom_fields where id = $1`, [
    current.id,
  ]);
  await audit(t, {
    action: "custom_field.removed",
    entityType: "project",
    entityId: current.project_id,
    projectId: current.project_id,
    before: {
      name: current.name,
      kind: current.kind,
      values: values?.n ?? 0,
    },
  });
  return { name: current.name, values: values?.n ?? 0 };
}

/**
 * Grava os valores da tarefa, pelo nome do campo (sem diferença de maiúsculas). Vazio ou
 * null tira o valor. Quem chama já travou a tarefa e conferiu a escrita. Devolve se algo
 * mudou.
 */
export async function setTaskFieldValues(
  t: TxCtx,
  task: { id: string; project_id: string; code: string },
  values: Record<string, string | number | null>,
): Promise<boolean> {
  const fields = await projectFields(t, task.project_id);
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f]));
  const current = new Map(
    (
      await many<{ field_id: string; value: string }>(
        t,
        `select field_id, value from ${S}.custom_field_values where task_id = $1`,
        [task.id],
      )
    ).map((r) => [r.field_id, r.value]),
  );
  let changed = false;
  for (const [name, raw] of Object.entries(values)) {
    const field = byName.get(name.trim().toLowerCase());
    if (!field) {
      throw unprocessable(
        fields.length === 0
          ? `O projeto não tem campos personalizados (“${name}”).`
          : `O campo “${name}” não existe neste projeto. Campos: ${fields.map((f) => f.name).join(", ")}.`,
      );
    }
    const normalized = normalizeFieldValue(field, raw);
    if (!normalized.ok) throw unprocessable(normalized.message);
    const before = current.get(field.id) ?? null;
    if (before === normalized.value) continue;
    changed = true;
    if (normalized.value === null) {
      await t.tx.query(
        `delete from ${S}.custom_field_values where task_id = $1 and field_id = $2`,
        [task.id, field.id],
      );
    } else {
      await t.tx.query(
        `insert into ${S}.custom_field_values (workspace_id, task_id, field_id, value)
         values ($1, $2, $3, $4)
         on conflict (task_id, field_id)
         do update set value = excluded.value, updated_at = now()`,
        [t.actor.workspaceId, task.id, field.id, normalized.value],
      );
    }
  }
  return changed;
}
