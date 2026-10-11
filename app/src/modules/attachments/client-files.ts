import { audit } from "@/lib/audit";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import {
  authorizeProjectId,
  iso,
  resolveProject,
  Uuid,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { checkUpload, storeContent } from "./service";

/**
 * Arquivos entregues ao cliente (PRD §9): ficam no projeto, visíveis ao cliente, e o
 * contato baixa pelo portal. Mandar um arquivo ao cliente é de quem decide (owner ou
 * admin, ação attachment.write_client); agente não manda (o banco também recusa,
 * migração 0009). Mesmas regras de tipo e tamanho dos anexos das tarefas.
 */

export const MAX_CLIENT_FILES = 50;

export type ClientFile = {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  at: string;
  /** Quem da equipe mandou (só na tela da equipe). */
  by: string | null;
};

type FileRow = {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  created_at: Date | string;
  by_name: string | null;
};

const toFile = (r: FileRow): ClientFile => ({
  id: r.id,
  filename: r.filename,
  mime: r.mime,
  sizeBytes: Number(r.size_bytes),
  at: iso(r.created_at),
  by: r.by_name,
});

/** Os arquivos entregues no projeto, do mais novo para o mais antigo (tela da equipe). */
export async function clientFiles(
  t: TxCtx,
  code: string,
): Promise<ClientFile[]> {
  const project = await resolveProject(t, code, "project.read");
  const rows = await many<FileRow>(
    t,
    `select a.id, a.filename, a.mime, a.size_bytes::int as size_bytes, a.created_at,
            pr.full_name as by_name
       from ${S}.attachments a
       left join ${S}.profiles pr
         on a.uploaded_by_type = 'user' and pr.id = a.uploaded_by_id
      where a.project_id = $1 and a.entity_type = 'project' and a.visibility = 'client'
      order by a.created_at desc, a.id desc`,
    [project.id],
  );
  return rows.map(toFile);
}

/** Manda um arquivo ao cliente: aparece na página do projeto, no portal. */
export async function addClientFile(
  t: TxCtx,
  code: string,
  file: { name: string; bytes: Uint8Array },
): Promise<{ id: string; filename: string }> {
  const project = await resolveProject(t, code, "attachment.write_client");
  if (project.status === "in_review") {
    throw unprocessable(
      "Projeto em revisão ainda não aparece para o cliente: ele passa a valer pela decisão da importação.",
    );
  }
  const kind = checkUpload(file);
  const count = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.attachments
      where project_id = $1 and entity_type = 'project' and visibility = 'client'`,
    [project.id],
  );
  if (count!.n >= MAX_CLIENT_FILES) {
    throw unprocessable(
      `O projeto ${project.code} já tem ${MAX_CLIENT_FILES} arquivos entregues. Tire algum antes de mandar outro.`,
    );
  }
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.attachments
       (workspace_id, project_id, entity_type, entity_id, storage_path, filename, mime,
        size_bytes, visibility, uploaded_by_type, uploaded_by_id)
     values ($1, $2, 'project', $2, 'db', $3, $4, $5, 'client', $6, $7)
     returning id`,
    [
      t.actor.workspaceId,
      project.id,
      kind.filename,
      kind.mime,
      file.bytes.length,
      t.actor.type,
      t.actor.id,
    ],
  );
  await storeContent(t, row!.id, file.bytes);
  await audit(t, {
    action: "attachment.client_added",
    entityType: "project",
    entityId: project.id,
    projectId: project.id,
    after: { filename: kind.filename, size_bytes: file.bytes.length },
  });
  return { id: row!.id, filename: kind.filename };
}

/** Tira um arquivo entregue: some do portal na hora. Owner e admin. */
export async function removeClientFile(t: TxCtx, id: string): Promise<void> {
  if (!Uuid.safeParse(id).success) throw badRequest("Arquivo inválido.");
  const row = await maybeOne<{ project_id: string; filename: string }>(
    t,
    `select project_id, filename from ${S}.attachments
      where id = $1 and entity_type = 'project' and visibility = 'client'`,
    [id],
  );
  if (!row) throw notFound("Arquivo não encontrado.");
  await authorizeProjectId(t, row.project_id, "attachment.write_client");
  await t.tx.query(`delete from ${S}.attachments where id = $1`, [id]);
  await audit(t, {
    action: "attachment.client_removed",
    entityType: "project",
    entityId: row.project_id,
    projectId: row.project_id,
    after: { filename: row.filename },
  });
}
