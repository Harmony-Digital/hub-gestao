import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { notFound } from "@/lib/errors";
import { iso, Uuid } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Privacidade (LGPD, M8; `docs/privacidade.md`). Só o dono (`portal.manage`, que agente
 * não tem):
 * - exportação dos dados de um cliente: o que o Hub guarda dele e dos contatos dele, para
 *   atender o pedido de acesso ou de portabilidade;
 * - exclusão dos dados pessoais de um contato: nome e e-mail trocados, acesso, sessões e
 *   links apagados, mensagens dele no canal trocadas por um aviso e o nome tirado dos
 *   avisos e das entregas de webhook. O registro do contato fica, marcado, para os
 *   vínculos. O histórico (activity_log) é só de inserção e não muda: é a trilha de
 *   auditoria.
 */

export const REMOVED_NAME = "Contato removido";
export const REMOVED_MESSAGE =
  "[Mensagem removida: os dados pessoais deste contato foram excluídos.]";

const at = (v: Date | string | null) => (v ? iso(v) : null);

export type ClientExport = {
  gerado_em: string;
  cliente: { nome: string; slug: string; criado_em: string | null };
  contatos: {
    nome: string;
    email: string;
    papel: string;
    acesso: string;
    convidado_em: string | null;
    aceite_lgpd_em: string | null;
    dados_excluidos_em: string | null;
    criado_em: string | null;
    sessoes: {
      criada_em: string | null;
      expira_em: string | null;
      encerrada_em: string | null;
      ultimo_uso_em: string | null;
    }[];
    links_de_acesso: {
      finalidade: string;
      criado_em: string | null;
      expira_em: string | null;
      usado_em: string | null;
    }[];
    mensagens: { projeto: string; em: string | null; texto: string }[];
    acoes_no_portal: {
      em: string | null;
      acao: string;
      projeto: string | null;
    }[];
  }[];
  projetos: {
    codigo: string;
    nome: string;
    fase: string;
    objetivo: string | null;
    entregas: {
      titulo: string | null;
      situacao: string;
      prazo: string | null;
      recebida_em: string | null;
      recebida_por: string | null;
    }[];
    frentes: { titulo: string | null; descricao: string | null }[];
    arquivos_entregues: { nome: string; bytes: number; em: string | null }[];
  }[];
};

async function clientBySlug(t: TxCtx, slug: string) {
  const row = await maybeOne<{
    id: string;
    slug: string;
    name: string;
    created_at: Date | string | null;
  }>(t, `select id, slug, name, created_at from ${S}.clients where slug = $1`, [
    slug,
  ]);
  if (!row) throw notFound("Cliente não encontrado.");
  return row;
}

/**
 * Os dados do cliente e dos contatos dele, num JSON com nomes em português (é para
 * entregar a quem pediu). Fica de fora o que é interno da equipe (tarefas, notas
 * internas, textos internos) e o que é segredo (hash de link e de sessão).
 */
export async function exportClientData(
  t: TxCtx,
  slug: string,
): Promise<ClientExport> {
  authorize(t.actor, "portal.manage");
  const client = await clientBySlug(t, slug);

  const contacts = await many<{
    id: string;
    profile_id: string | null;
    name: string;
    email: string;
    role: string;
    access_status: string;
    invited_at: Date | string | null;
    consent_at: Date | string | null;
    anonymized_at: Date | string | null;
    created_at: Date | string | null;
  }>(
    t,
    `select id, profile_id, name, email, role, access_status::text as access_status,
            invited_at, consent_at, anonymized_at, created_at
       from ${S}.client_contacts where client_id = $1 order by name`,
    [client.id],
  );

  const contatos: ClientExport["contatos"] = [];
  for (const c of contacts) {
    const sessions = await many<{
      created_at: Date | string;
      expires_at: Date | string;
      revoked_at: Date | string | null;
      last_seen_at: Date | string | null;
    }>(
      t,
      `select created_at, expires_at, revoked_at, last_seen_at
         from ${S}.client_sessions where contact_id = $1 order by created_at`,
      [c.id],
    );
    const links = await many<{
      purpose: string;
      created_at: Date | string;
      expires_at: Date | string;
      used_at: Date | string | null;
    }>(
      t,
      `select purpose, created_at, expires_at, used_at
         from ${S}.client_access_links where contact_id = $1 order by created_at`,
      [c.id],
    );
    const messages = c.profile_id
      ? await many<{
          code: string;
          created_at: Date | string;
          body_md: string;
        }>(
          t,
          `select p.code, cm.created_at, cm.body_md
             from ${S}.comments cm
             join ${S}.projects p on p.id = cm.project_id
            where cm.author_id = $1 and cm.acting_role = 'client_contact'
              and p.client_id = $2
            order by cm.created_at`,
          [c.profile_id, client.id],
        )
      : [];
    const actions = c.profile_id
      ? await many<{
          created_at: Date | string;
          action: string;
          code: string | null;
        }>(
          t,
          `select a.created_at, a.action, p.code
             from ${S}.activity_log a
             left join ${S}.projects p on p.id = a.project_id
            where a.actor_type = 'user' and a.actor_id = $1
              and a.acting_role = 'client_contact'
            order by a.id`,
          [c.profile_id],
        )
      : [];
    contatos.push({
      nome: c.name,
      email: c.email,
      papel: c.role === "client_approver" ? "decisor" : "acompanha",
      acesso: c.access_status,
      convidado_em: at(c.invited_at),
      aceite_lgpd_em: at(c.consent_at),
      dados_excluidos_em: at(c.anonymized_at),
      criado_em: at(c.created_at),
      sessoes: sessions.map((s) => ({
        criada_em: at(s.created_at),
        expira_em: at(s.expires_at),
        encerrada_em: at(s.revoked_at),
        ultimo_uso_em: at(s.last_seen_at),
      })),
      links_de_acesso: links.map((l) => ({
        finalidade: l.purpose === "invite" ? "convite" : "acesso",
        criado_em: at(l.created_at),
        expira_em: at(l.expires_at),
        usado_em: at(l.used_at),
      })),
      mensagens: messages.map((m) => ({
        projeto: m.code,
        em: at(m.created_at),
        texto: m.body_md,
      })),
      acoes_no_portal: actions.map((a) => ({
        em: at(a.created_at),
        acao: a.action,
        projeto: a.code,
      })),
    });
  }

  const projects = await many<{
    id: string;
    code: string;
    name: string;
    phase: string;
    objective_client: string | null;
  }>(
    t,
    `select id, code, name, phase::text as phase, objective_client
       from ${S}.projects where client_id = $1 order by code`,
    [client.id],
  );
  const projetos: ClientExport["projetos"] = [];
  for (const p of projects) {
    const milestones = await many<{
      title_client: string | null;
      status: string;
      due_date: string | null;
      client_received_at: Date | string | null;
      client_received_by_name: string | null;
    }>(
      t,
      `select title_client, status::text as status, due_date::text as due_date,
              client_received_at, client_received_by_name
         from ${S}.milestones
        where project_id = $1 and title_client is not null
        order by sort_order, created_at`,
      [p.id],
    );
    const workstreams = await many<{
      title_client: string | null;
      description_client: string | null;
    }>(
      t,
      `select title_client, description_client from ${S}.workstreams
        where project_id = $1 and title_client is not null
        order by sort_order, created_at`,
      [p.id],
    );
    const files = await many<{
      filename: string;
      size_bytes: number;
      created_at: Date | string;
    }>(
      t,
      `select filename, size_bytes::int as size_bytes, created_at
         from ${S}.attachments
        where project_id = $1 and entity_type = 'project'
        order by created_at`,
      [p.id],
    );
    projetos.push({
      codigo: p.code,
      nome: p.name,
      fase: p.phase,
      objetivo: p.objective_client,
      entregas: milestones.map((m) => ({
        titulo: m.title_client,
        situacao: m.status,
        prazo: m.due_date,
        recebida_em: at(m.client_received_at),
        recebida_por: m.client_received_by_name,
      })),
      frentes: workstreams.map((w) => ({
        titulo: w.title_client,
        descricao: w.description_client,
      })),
      arquivos_entregues: files.map((f) => ({
        nome: f.filename,
        bytes: Number(f.size_bytes),
        em: at(f.created_at),
      })),
    });
  }

  return {
    gerado_em: new Date().toISOString(),
    cliente: {
      nome: client.name,
      slug: client.slug,
      criado_em: at(client.created_at),
    },
    contatos,
    projetos,
  };
}

export type AnonymizeResult = {
  already: boolean;
  messages: number;
  sessions: number;
  links: number;
};

/**
 * Exclui os dados pessoais de um contato (pedido do titular ou fim do contrato). Não tem
 * volta: exporte antes, se precisar. O perfil do contato só é anonimizado quando nenhum
 * outro contato ativo usa o mesmo perfil (a mesma pessoa em outro cliente).
 */
export async function anonymizeContact(
  t: TxCtx,
  contactId: string,
): Promise<AnonymizeResult> {
  authorize(t.actor, "portal.manage");
  if (!Uuid.safeParse(contactId).success) {
    throw notFound("Contato não encontrado.");
  }
  const contact = await maybeOne<{
    id: string;
    client_id: string;
    profile_id: string | null;
    name: string;
    anonymized_at: Date | string | null;
  }>(
    t,
    `select id, client_id, profile_id, name, anonymized_at
       from ${S}.client_contacts where id = $1 for update`,
    [contactId],
  );
  if (!contact) throw notFound("Contato não encontrado.");
  if (contact.anonymized_at) {
    return { already: true, messages: 0, sessions: 0, links: 0 };
  }
  const placeholder = `removido-${contact.id.slice(0, 8)}@removido.invalid`;
  const oldName = contact.name;

  const sessions = await many(
    t,
    `delete from ${S}.client_sessions where contact_id = $1 returning id`,
    [contact.id],
  );
  const links = await many(
    t,
    `delete from ${S}.client_access_links where contact_id = $1 returning id`,
    [contact.id],
  );
  await t.tx.query(
    `update ${S}.client_contacts
        set name = $2, email = $3, access_status = 'revoked', consent_at = null,
            anonymized_at = now()
      where id = $1`,
    [contact.id, REMOVED_NAME, placeholder],
  );

  let messages = 0;
  if (contact.profile_id) {
    // As mensagens dele no canal dos projetos deste cliente.
    const comments = await many<{ id: string }>(
      t,
      `update ${S}.comments cm
          set body_md = $3, author_name = $4, mentions = '[]'::jsonb
         from ${S}.projects p
        where p.id = cm.project_id and p.client_id = $2
          and cm.author_id = $1 and cm.acting_role = 'client_contact'
        returning cm.id`,
      [contact.profile_id, contact.client_id, REMOVED_MESSAGE, REMOVED_NAME],
    );
    messages = comments.length;
    // Os avisos da equipe sobre essas mensagens e as confirmações de entrega dele.
    if (comments.length > 0) {
      await t.tx.query(
        `update ${S}.notifications
            set payload = payload || jsonb_build_object('author', $2::text, 'excerpt', null)
          where entity_id = any($1::uuid[])`,
        [comments.map((c) => c.id), REMOVED_NAME],
      );
    }
    await t.tx.query(
      `update ${S}.milestones m
          set client_received_by_name = $3
         from ${S}.projects p
        where p.id = m.project_id and p.client_id = $2
          and m.client_received_by_profile_id = $1`,
      [contact.profile_id, contact.client_id, REMOVED_NAME],
    );
    // O perfil só sai se nenhum outro contato ainda ativo usa o mesmo perfil.
    const shared = await maybeOne(
      t,
      `select 1 from ${S}.client_contacts
        where profile_id = $1 and id <> $2 and anonymized_at is null`,
      [contact.profile_id, contact.id],
    );
    if (!shared) {
      await t.tx.query(
        `update ${S}.profiles
            set full_name = $2, email = $3, avatar_url = null,
                deactivated_at = coalesce(deactivated_at, now())
          where id = $1`,
        [contact.profile_id, REMOVED_NAME, placeholder],
      );
    }
  }
  // Avisos e entregas de webhook que levam o nome dele (mensagem e confirmação de entrega).
  await t.tx.query(
    `update ${S}.notifications
        set payload = payload || jsonb_build_object('author', $1::text, 'excerpt', null)
      where type in ('client.comment', 'client.receipt') and payload->>'author' = $2`,
    [REMOVED_NAME, oldName],
  );
  await t.tx.query(
    `update ${S}.webhook_deliveries
        set payload = jsonb_set(
              jsonb_set(payload, '{data,author}', to_jsonb($1::text)),
              '{data,excerpt}', 'null'::jsonb)
      where event in ('client.commented', 'client.receipt_confirmed')
        and payload->'data'->>'author' = $2`,
    [REMOVED_NAME, oldName],
  );

  await audit(t, {
    action: "client_contact.anonymized",
    entityType: "client_contact",
    entityId: contact.id,
    after: {
      client_id: contact.client_id,
      messages,
      sessions: sessions.length,
      links: links.length,
    },
  });
  return {
    already: false,
    messages,
    sessions: sessions.length,
    links: links.length,
  };
}

/** Fim do contrato: exclui os dados pessoais de todos os contatos do cliente. */
export async function anonymizeClientContacts(
  t: TxCtx,
  clientId: string,
): Promise<{ contacts: number; messages: number }> {
  authorize(t.actor, "portal.manage");
  if (!Uuid.safeParse(clientId).success) {
    throw notFound("Cliente não encontrado.");
  }
  const contacts = await many<{ id: string }>(
    t,
    `select id from ${S}.client_contacts
      where client_id = $1 and anonymized_at is null order by created_at`,
    [clientId],
  );
  let messages = 0;
  for (const c of contacts) {
    messages += (await anonymizeContact(t, c.id)).messages;
  }
  return { contacts: contacts.length, messages };
}

/** Retenção (LGPD): o relógio do Hub chama uma vez por dia (`apply_retention`, 0021). */
export async function applyRetention(
  t: TxCtx,
): Promise<Record<string, number>> {
  const row = await maybeOne<{ r: Record<string, number> }>(
    t,
    `select ${S}.apply_retention() as r`,
  );
  return row?.r ?? {};
}
