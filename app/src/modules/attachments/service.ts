import { createHash } from "node:crypto";
import { audit } from "@/lib/audit";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import {
  ACTOR_NAME_SQL,
  actorRef,
  authorizeProjectId,
  iso,
  Uuid,
  type ActorRef,
} from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { lockTask } from "@/modules/tasks/service";

/**
 * Anexos da tarefa (painel lateral, M3). O conteúdo fica em `attachment_contents`, no
 * schema do Hub (migração 0011), até 10 MB por arquivo e 20 por tarefa. Só tipos comuns
 * de trabalho; nada que o navegador execute (HTML, SVG, scripts).
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_PER_TASK = 20;

/** Tipo aceito → extensões. O tipo gravado vem desta lista, nunca do que o navegador diz. */
const TYPES: Record<string, string[]> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt", "log"],
  "text/csv": ["csv"],
  "text/markdown": ["md"],
  "application/json": ["json"],
  "application/zip": ["zip"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "docx",
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    "pptx",
  ],
};

/** Assinatura dos primeiros bytes, para quem declara ser imagem, PDF ou zip. */
function signatureOk(mime: string, bytes: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (mime) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/gif":
      return starts(0x47, 0x49, 0x46, 0x38);
    case "image/webp":
      return (
        starts(0x52, 0x49, 0x46, 0x46) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    case "application/pdf":
      return starts(0x25, 0x50, 0x44, 0x46);
    case "application/zip":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return starts(0x50, 0x4b, 0x03, 0x04);
    default:
      // Texto: nada de bytes nulos (arquivo binário disfarçado de .txt).
      return !bytes.subarray(0, 4096).includes(0);
  }
}

/** Nome sem caminho e sem caracteres de controle; o tipo sai da extensão. */
export function fileKind(
  rawName: string,
): { filename: string; mime: string } | null {
  const base = rawName.split(/[\\/]/).pop() ?? "";
  const filename = base.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!filename || filename.length > 200) return null;
  const ext = filename.includes(".")
    ? filename.split(".").pop()!.toLowerCase()
    : "";
  const mime = Object.entries(TYPES).find(([, exts]) => exts.includes(ext));
  return mime ? { filename, mime: mime[0] } : null;
}

export const ACCEPTED_EXTENSIONS = Object.values(TYPES)
  .flat()
  .map((e) => `.${e}`)
  .join(",");

export type AttachmentDto = {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  uploaded_by: ActorRef | null;
  created_at: string;
};

type AttachmentRow = Omit<AttachmentDto, "uploaded_by" | "created_at"> & {
  uploaded_by_type: string;
  uploaded_by_id: string | null;
  uploaded_by_name: string | null;
  created_at: Date | string;
};

const SELECT = `
  select a.id, a.filename, a.mime, a.size_bytes::int as size_bytes,
         a.uploaded_by_type::text as uploaded_by_type, a.uploaded_by_id,
         ${ACTOR_NAME_SQL("a.uploaded_by_type::text", "a.uploaded_by_id")} as uploaded_by_name,
         a.created_at
    from ${S}.attachments a`;

function toDto(r: AttachmentRow): AttachmentDto {
  return {
    id: r.id,
    filename: r.filename,
    mime: r.mime,
    size_bytes: Number(r.size_bytes),
    uploaded_by: actorRef(
      r.uploaded_by_type,
      r.uploaded_by_id,
      r.uploaded_by_name,
    ),
    created_at: iso(r.created_at),
  };
}

export async function attachmentsOf(
  t: TxCtx,
  taskId: string,
): Promise<AttachmentDto[]> {
  const rows = await many<AttachmentRow>(
    t,
    `${SELECT} where a.entity_type = 'task' and a.entity_id = $1
      order by a.created_at, a.id`,
    [taskId],
  );
  return rows.map(toDto);
}

export async function addAttachment(
  t: TxCtx,
  code: string,
  file: { name: string; bytes: Uint8Array },
): Promise<AttachmentDto> {
  const task = await lockTask(t, code, "task.write");
  const kind = fileKind(file.name);
  if (!kind) {
    throw unprocessable(
      "Tipo de arquivo não aceito. Use imagem (PNG, JPG, GIF, WebP), PDF, texto, CSV, Markdown, JSON, zip ou documento do Office.",
    );
  }
  if (file.bytes.length === 0) throw badRequest("O arquivo está vazio.");
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) {
    throw unprocessable("O arquivo passou de 10 MB.");
  }
  if (!signatureOk(kind.mime, file.bytes)) {
    throw unprocessable(
      `O conteúdo de ${kind.filename} não corresponde ao tipo do arquivo.`,
    );
  }
  const count = await maybeOne<{ n: number }>(
    t,
    `select count(*)::int as n from ${S}.attachments where entity_type = 'task' and entity_id = $1`,
    [task.id],
  );
  if (count!.n >= MAX_PER_TASK) {
    throw unprocessable(
      `A tarefa ${task.code} já tem ${MAX_PER_TASK} anexos. Tire algum antes de anexar outro.`,
    );
  }
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.attachments
       (workspace_id, project_id, entity_type, entity_id, storage_path, filename, mime,
        size_bytes, visibility, uploaded_by_type, uploaded_by_id)
     values ($1, $2, 'task', $3, 'db', $4, $5, $6, 'internal', $7, $8)
     returning id`,
    [
      t.actor.workspaceId,
      task.project_id,
      task.id,
      kind.filename,
      kind.mime,
      file.bytes.length,
      t.actor.type,
      t.actor.id,
    ],
  );
  await t.tx.query(
    `insert into ${S}.attachment_contents (attachment_id, workspace_id, sha256, content)
     values ($1, $2, $3, $4)`,
    [
      row!.id,
      t.actor.workspaceId,
      createHash("sha256").update(file.bytes).digest("hex"),
      Buffer.from(file.bytes),
    ],
  );
  await audit(t, {
    action: "attachment.added",
    entityType: "task",
    entityId: task.id,
    projectId: task.project_id,
    after: { filename: kind.filename, size_bytes: file.bytes.length },
  });
  const dto = await maybeOne<AttachmentRow>(t, `${SELECT} where a.id = $1`, [
    row!.id,
  ]);
  return toDto(dto!);
}

type Located = {
  id: string;
  filename: string;
  mime: string;
  project_id: string;
  task_id: string;
};

async function locate(t: TxCtx, id: string): Promise<Located> {
  if (!Uuid.safeParse(id).success) throw badRequest("Anexo inválido.");
  const row = await maybeOne<Located>(
    t,
    `select a.id, a.filename, a.mime, a.project_id, a.entity_id as task_id
       from ${S}.attachments a
      where a.id = $1 and a.entity_type = 'task'`,
    [id],
  );
  if (!row) throw notFound("Anexo não encontrado.");
  return row;
}

/** Conteúdo para download, com a leitura de tarefas conferida no projeto. */
export async function readAttachment(
  t: TxCtx,
  id: string,
): Promise<{ filename: string; mime: string; content: Buffer }> {
  const a = await locate(t, id);
  await authorizeProjectId(t, a.project_id, "task.read");
  const row = await maybeOne<{ content: Uint8Array }>(
    t,
    `select content from ${S}.attachment_contents where attachment_id = $1`,
    [id],
  );
  if (!row) throw notFound("O conteúdo deste anexo não está disponível.");
  return {
    filename: a.filename,
    mime: a.mime,
    content: Buffer.from(row.content),
  };
}

export async function removeAttachment(t: TxCtx, id: string): Promise<void> {
  const a = await locate(t, id);
  await authorizeProjectId(t, a.project_id, "task.write");
  await t.tx.query(`delete from ${S}.attachments where id = $1`, [id]);
  await audit(t, {
    action: "attachment.removed",
    entityType: "task",
    entityId: a.task_id,
    projectId: a.project_id,
    after: { filename: a.filename },
  });
}
