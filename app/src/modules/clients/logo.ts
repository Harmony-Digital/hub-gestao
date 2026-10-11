import { createHash } from "node:crypto";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { badRequest, notFound, unprocessable } from "@/lib/errors";
import { signatureOk } from "@/modules/attachments/service";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Logo do cliente (RF-04): aparece na tela Clientes e no topo do portal. Um por cliente,
 * na tabela da migração 0022: PNG, JPEG ou WebP, até 1 MB. SVG fica de fora (o navegador
 * executa script dentro dele). O tipo sai da extensão e é conferido pelos primeiros
 * bytes, nunca pelo que o navegador diz. Só dono e administração enviam e removem.
 */

export const MAX_LOGO_BYTES = 1024 * 1024;

const LOGO_TYPES: Record<string, "image/png" | "image/jpeg" | "image/webp"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const LOGO_ACCEPT = ".png,.jpg,.jpeg,.webp";

/** Confere o arquivo do logo e devolve o tipo que será gravado. */
export function logoKind(file: { name: string; bytes: Uint8Array }): string {
  const name = file.name.split(/[\\/]/).pop() ?? "";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const mime = LOGO_TYPES[ext];
  if (!mime) throw unprocessable("O logo precisa ser PNG, JPG ou WebP.");
  if (file.bytes.length === 0) throw badRequest("O arquivo está vazio.");
  if (file.bytes.length > MAX_LOGO_BYTES) {
    throw unprocessable("O logo passou de 1 MB. Use uma imagem menor.");
  }
  if (!signatureOk(mime, file.bytes)) {
    throw unprocessable(
      "O conteúdo do arquivo não é uma imagem PNG, JPG ou WebP.",
    );
  }
  return mime;
}

/** Os 12 primeiros caracteres do hash: mudam quando o logo muda (endereço com ?v=). */
const VERSION_SQL = "left(l.sha256, 12)";

export async function setClientLogo(
  t: TxCtx,
  clientId: string,
  file: { name: string; bytes: Uint8Array },
): Promise<{ version: string }> {
  authorize(t.actor, "workspace.admin");
  const mime = logoKind(file);
  const client = await maybeOne<{ archived: boolean }>(
    t,
    `select archived_at is not null as archived from ${S}.clients where id = $1`,
    [clientId],
  );
  if (!client) throw notFound("Cliente não encontrado neste workspace.");
  if (client.archived) {
    throw unprocessable("Cliente arquivado não muda. Restaure antes.");
  }
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  await t.tx.query(
    `insert into ${S}.client_logos (client_id, workspace_id, mime, sha256, content)
     values ($1, $2, $3, $4, $5)
     on conflict (client_id) do update
       set mime = excluded.mime, sha256 = excluded.sha256,
           content = excluded.content, updated_at = now()`,
    [clientId, t.actor.workspaceId, mime, sha256, Buffer.from(file.bytes)],
  );
  await audit(t, {
    action: "client.logo_changed",
    entityType: "client",
    entityId: clientId,
    after: { mime, bytes: file.bytes.length },
  });
  return { version: sha256.slice(0, 12) };
}

export async function removeClientLogo(
  t: TxCtx,
  clientId: string,
): Promise<void> {
  authorize(t.actor, "workspace.admin");
  const removed = await maybeOne<{ client_id: string }>(
    t,
    `delete from ${S}.client_logos where client_id = $1 returning client_id`,
    [clientId],
  );
  if (!removed) throw notFound("Este cliente não tem logo.");
  await audit(t, {
    action: "client.logo_removed",
    entityType: "client",
    entityId: clientId,
  });
}

/** A versão do logo de cada cliente que tem logo (id do cliente → versão). */
export async function logoVersions(t: TxCtx): Promise<Map<string, string>> {
  authorize(t.actor, "project.read");
  const rows = await many<{ client_id: string; version: string }>(
    t,
    `select l.client_id, ${VERSION_SQL} as version from ${S}.client_logos l`,
  );
  return new Map(rows.map((r) => [r.client_id, r.version]));
}

/** O logo para a tela da equipe, pelo endereço do cliente. */
export async function readClientLogo(
  t: TxCtx,
  slug: string,
): Promise<{ mime: string; content: Buffer } | null> {
  authorize(t.actor, "project.read");
  const row = await maybeOne<{ mime: string; content: Uint8Array }>(
    t,
    `select l.mime, l.content from ${S}.client_logos l
       join ${S}.clients c on c.id = l.client_id
      where c.slug = $1`,
    [slug],
  );
  return row ? { mime: row.mime, content: Buffer.from(row.content) } : null;
}
