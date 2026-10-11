import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { conflict, notFound, unprocessable } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import { Uuid } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Etiquetas das tarefas (RF-18): do workspace inteiro, pelo nome. Quem edita a tarefa
 * põe e tira etiquetas; etiqueta nova nasce pelo nome (sem diferenciar maiúsculas de uma
 * que já existe) e ganha uma cor da paleta. Renomear, mudar a cor e remover é do dono e
 * da administração (Configurações). Agente põe etiqueta pela edição da tarefa, como uma
 * pessoa.
 */

export const MAX_LABELS_PER_TASK = 10;
export const MAX_LABELS = 200;

/** Cores das etiquetas novas, na ordem (a próxima é a menos usada). */
export const LABEL_PALETTE = [
  "#1D4ED8",
  "#0F766E",
  "#C2410C",
  "#A21CAF",
  "#4D7C0F",
  "#B45309",
  "#3B4A8C",
  "#BE123C",
] as const;

export const LabelName = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "Etiqueta sem nome.")
      .max(40, "Etiqueta com até 40 caracteres.")
      .regex(
        /^[^\u0000-\u001F\u007F,]+$/,
        "Etiqueta sem vírgula, numa linha só.",
      ),
  );

export const LabelList = z
  .array(LabelName)
  .max(MAX_LABELS_PER_TASK, `Até ${MAX_LABELS_PER_TASK} etiquetas por tarefa.`)
  .describe(
    "Lista completa das etiquetas da tarefa, pelo nome (substitui a anterior; [] tira todas). Nome que não existe vira etiqueta nova.",
  );

export type LabelRef = { name: string; color: string };

export type LabelDto = LabelRef & { id: string; task_count: number };

/** Todas as etiquetas do workspace, com quantas tarefas ativas usam cada uma. */
export async function listLabels(t: TxCtx): Promise<LabelDto[]> {
  authorize(t.actor, "task.read");
  const rows = await many<LabelDto>(
    t,
    `select l.id, l.name, l.color,
            (select count(*)::int from ${S}.task_labels tl
               join ${S}.tasks tk on tk.id = tl.task_id
              where tl.label_id = l.id and tk.archived_at is null) as task_count
       from ${S}.labels l
      order by lower(l.name)`,
  );
  return rows.map((r) => ({ ...r, task_count: Number(r.task_count) }));
}

/**
 * Troca as etiquetas de uma tarefa pela lista dada (quem chama já conferiu a escrita da
 * tarefa). Devolve se mudou. Nome repetido conta uma vez.
 */
export async function setTaskLabels(
  t: TxCtx,
  task: { id: string },
  input: string[],
): Promise<boolean> {
  const names = LabelList.parse(input);
  assertNoSecrets(
    Object.fromEntries(names.map((n, i) => [`etiqueta ${i + 1}`, n])),
  );
  const wanted = new Map<string, string>();
  for (const name of names) {
    if (!wanted.has(name.toLowerCase())) wanted.set(name.toLowerCase(), name);
  }
  const ids: string[] = [];
  for (const [key, name] of wanted) {
    const found = await maybeOne<{ id: string }>(
      t,
      `select id from ${S}.labels where lower(name) = $1`,
      [key],
    );
    ids.push(found?.id ?? (await createLabel(t, name)));
  }
  const current = await many<{ label_id: string }>(
    t,
    `select label_id from ${S}.task_labels where task_id = $1`,
    [task.id],
  );
  const now = new Set(current.map((r) => r.label_id));
  if (now.size === ids.length && ids.every((id) => now.has(id))) return false;
  await t.tx.query(
    `delete from ${S}.task_labels where task_id = $1 and not (label_id = any($2::uuid[]))`,
    [task.id, ids],
  );
  await t.tx.query(
    `insert into ${S}.task_labels (workspace_id, task_id, label_id)
     select $1, $2, unnest($3::uuid[])
     on conflict do nothing`,
    [t.actor.workspaceId, task.id, ids],
  );
  return true;
}

async function createLabel(t: TxCtx, name: string): Promise<string> {
  const usage = await many<{ color: string; n: number }>(
    t,
    `select color, count(*)::int as n from ${S}.labels group by color`,
  );
  const total = usage.reduce((sum, u) => sum + Number(u.n), 0);
  if (total >= MAX_LABELS) {
    throw unprocessable(
      `O workspace já tem ${MAX_LABELS} etiquetas. Use uma que já existe ou peça para remover as que sobram.`,
    );
  }
  const used = new Map(usage.map((u) => [u.color.toUpperCase(), Number(u.n)]));
  const color = [...LABEL_PALETTE].sort(
    (a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0),
  )[0];
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.labels (workspace_id, name, color) values ($1, $2, $3)
     returning id`,
    [t.actor.workspaceId, name, color],
  );
  await audit(t, {
    action: "label.created",
    entityType: "label",
    entityId: row!.id,
    after: { name, color },
  });
  return row!.id;
}

export const LabelInput = z.strictObject({
  name: LabelName,
  color: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Use a cor no formato #RRGGBB."),
});

/** Novo nome ou nova cor (dono e administração): vale em todas as tarefas. */
export async function updateLabel(
  t: TxCtx,
  id: string,
  input: z.input<typeof LabelInput>,
): Promise<void> {
  authorize(t.actor, "workspace.admin");
  if (!Uuid.safeParse(id).success) throw notFound("Etiqueta não encontrada.");
  const { name, color } = LabelInput.parse(input);
  assertNoSecrets({ name });
  const before = await maybeOne<{ name: string; color: string }>(
    t,
    `select name, color from ${S}.labels where id = $1 for update`,
    [id],
  );
  if (!before) throw notFound("Etiqueta não encontrada.");
  const next = { name, color: color.toUpperCase() };
  if (before.name === next.name && before.color.toUpperCase() === next.color) {
    return;
  }
  const taken = await maybeOne(
    t,
    `select 1 from ${S}.labels where lower(name) = lower($1) and id <> $2`,
    [name, id],
  );
  if (taken) throw conflict(`Já existe uma etiqueta chamada “${name}”.`);
  await t.tx.query(
    `update ${S}.labels set name = $2, color = $3 where id = $1`,
    [id, next.name, next.color],
  );
  await audit(t, {
    action: "label.updated",
    entityType: "label",
    entityId: id,
    before,
    after: next,
  });
}

/** Remove a etiqueta de todas as tarefas (dono e administração). */
export async function removeLabel(t: TxCtx, id: string): Promise<void> {
  authorize(t.actor, "workspace.admin");
  if (!Uuid.safeParse(id).success) throw notFound("Etiqueta não encontrada.");
  const row = await maybeOne<{ name: string }>(
    t,
    `delete from ${S}.labels where id = $1 returning name`,
    [id],
  );
  if (!row) throw notFound("Etiqueta não encontrada.");
  await audit(t, {
    action: "label.removed",
    entityType: "label",
    entityId: id,
    before: { name: row.name },
  });
}
