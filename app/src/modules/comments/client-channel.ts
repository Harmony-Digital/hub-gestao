import { audit } from "@/lib/audit";
import { unprocessable } from "@/lib/errors";
import { assertNoSecrets } from "@/lib/text-guards";
import { iso, resolveProject } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";
import { emitEvent } from "@/modules/events";
import { notifyOwners, notifyProfile } from "@/modules/notifications";
import { excerpt } from "./service";

/**
 * Canal do cliente (PRD §5.2 e §9): a conversa do projeto que o cliente vê no portal. O
 * cliente escreve pelo portal (função post_client_comment, migração 0017, que confere a
 * sessão e marca a mensagem com acting_role 'client_contact'); a equipe lê e responde
 * aqui. Escrever para o cliente é de pessoa com papel de decisão (owner ou admin, ação
 * comment.write_client); agente não escreve no canal (o banco recusa, migração 0009).
 */

export const CLIENT_MESSAGE_MAX = 4000;

/** Marca das mensagens que vieram do portal (escritas pelo contato do cliente). */
export const FROM_CLIENT = "client_contact";

export type ChannelMessage = {
  id: string;
  author: string;
  fromClient: boolean;
  at: string;
  bodyMd: string;
};

type MessageRow = {
  id: string;
  author_name: string;
  acting_role: string | null;
  created_at: Date | string;
  body_md: string;
};

export const toMessage = (r: MessageRow): ChannelMessage => ({
  id: r.id,
  author: r.author_name,
  fromClient: r.acting_role === FROM_CLIENT,
  at: iso(r.created_at),
  bodyMd: r.body_md,
});

/** Mensagens do canal, da mais antiga para a mais nova (as 100 últimas). */
export const CHANNEL_SQL = `
  select c.id, c.author_name, c.acting_role, c.created_at, c.body_md
    from ${S}.comments c
   where c.project_id = $1 and c.entity_type = 'project' and c.visibility = 'client'
   order by c.created_at desc, c.id desc
   limit 100`;

/** O canal visto pela equipe, com a informação de o cliente já ter o portal ligado. */
export async function clientChannel(
  t: TxCtx,
  code: string,
): Promise<{ portalEnabled: boolean; messages: ChannelMessage[] }> {
  const project = await resolveProject(t, code, "comment.read");
  const client = await maybeOne<{ portal_enabled: boolean }>(
    t,
    `select cl.portal_enabled
       from ${S}.projects p join ${S}.clients cl on cl.id = p.client_id
      where p.id = $1`,
    [project.id],
  );
  const rows = await many<MessageRow>(t, CHANNEL_SQL, [project.id]);
  return {
    portalEnabled: client?.portal_enabled ?? false,
    messages: rows.reverse().map(toMessage),
  };
}

/** Resposta da equipe no canal: o cliente vê no portal. Owner e admin (D9). */
export async function postToClientChannel(
  t: TxCtx,
  code: string,
  body: string,
): Promise<{ id: string }> {
  const project = await resolveProject(t, code, "comment.write_client");
  if (project.status === "in_review") {
    throw unprocessable(
      "Projeto em revisão ainda não tem conversa com o cliente: ele passa a valer pela decisão da importação.",
    );
  }
  const text = body.trim();
  if (!text || text.length > CLIENT_MESSAGE_MAX) {
    throw unprocessable(
      `A mensagem precisa ter de 1 a ${CLIENT_MESSAGE_MAX} caracteres.`,
    );
  }
  assertNoSecrets({ body_md: text });
  const row = await maybeOne<{ id: string }>(
    t,
    `insert into ${S}.comments
       (workspace_id, project_id, entity_type, entity_id, body_md, visibility,
        author_type, author_id, author_name)
     values ($1, $2, 'project', $2, $3, 'client', $4, $5, $6)
     returning id`,
    [
      t.actor.workspaceId,
      project.id,
      text,
      t.actor.type,
      t.actor.id,
      t.actor.name,
    ],
  );
  // O histórico guarda o fato; o texto fica só no próprio comentário.
  await audit(t, {
    action: "comment.client_channel_posted",
    entityType: "comment",
    entityId: row!.id,
    projectId: project.id,
    after: { project: project.code },
  });
  return { id: row!.id };
}

/**
 * Avisa a equipe quando o cliente escreve no canal: os donos e o responsável pelo
 * projeto, na caixa de entrada, e os webhooks que assinam "client.commented" (o
 * Telegram, pelo Hermes). Roda como o próprio Hub, depois de a mensagem estar gravada.
 */
export async function noteClientMessage(
  t: TxCtx,
  commentId: string,
): Promise<void> {
  const row = await maybeOne<{
    project_id: string;
    code: string;
    owner_profile_id: string | null;
    author_name: string;
    body_md: string;
    lead_is_owner: boolean;
  }>(
    t,
    `select p.id as project_id, p.code, p.owner_profile_id, c.author_name, c.body_md,
            exists (select 1 from ${S}.memberships m
                     where m.profile_id = p.owner_profile_id and m.role = 'owner'
                       and m.status = 'active') as lead_is_owner
       from ${S}.comments c join ${S}.projects p on p.id = c.project_id
      where c.id = $1 and c.acting_role = $2`,
    [commentId, FROM_CLIENT],
  );
  if (!row) return;
  const payload = {
    project_code: row.code,
    author: row.author_name,
    excerpt: excerpt(row.body_md),
  };
  const entity = { type: "project", id: row.project_id };
  await notifyOwners(t, "client.comment", entity, payload);
  if (row.owner_profile_id && !row.lead_is_owner) {
    await notifyProfile(
      t,
      row.owner_profile_id,
      "client.comment",
      entity,
      payload,
    );
  }
  await emitEvent(t, "client.commented", payload);
}
