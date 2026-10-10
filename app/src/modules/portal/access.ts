import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { authorize } from "@/lib/authorize";
import { conflict, notFound, unprocessable } from "@/lib/errors";
import { generatePortalToken, hashPortalToken } from "@/lib/portal/token";
import { iso, Line, Uuid } from "@/modules/common";
import { many, maybeOne, S, type TxCtx } from "@/modules/context";

/**
 * Contatos de cliente e o acesso deles ao portal (D9). O contato nasce sem acesso. Só o
 * dono libera (botão "Liberar acesso"): o Hub liga o portal do cliente, cria o perfil do
 * contato (o id dele no portal, sem vínculo com a equipe) e gera um link de uso único
 * para o dono mandar por onde quiser. Gerar outro link anula o anterior; revogar encerra
 * as sessões e anula os links. O link e a sessão ficam no banco só como hash.
 */

export const CONTACT_ROLES = ["client_viewer", "client_approver"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const ContactInput = z.strictObject({
  name: Line(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "E-mail inválido."),
  role: z.enum(CONTACT_ROLES),
});
export type ContactInput = z.infer<typeof ContactInput>;

export type AccessStatus = "none" | "invited" | "active" | "revoked";

export type PortalClient = {
  id: string;
  slug: string;
  name: string;
  portalEnabled: boolean;
};

export type ContactItem = {
  id: string;
  name: string;
  email: string;
  role: ContactRole;
  accessStatus: AccessStatus;
  invitedAt: string | null;
  consentAt: string | null;
  /** Último acesso ao portal (de qualquer sessão), se houver. */
  lastSeenAt: string | null;
  /** Link ainda não usado e dentro da validade. */
  pendingLinkUntil: string | null;
};

/** Validade do link de uso único. */
export const LINK_DAYS = 7;

const TEAM_EMAIL =
  "Esse e-mail é de alguém da equipe. O portal é para os contatos do cliente: use outro e-mail.";

export async function portalClient(
  t: TxCtx,
  slug: string,
): Promise<PortalClient> {
  authorize(t.actor, "workspace.admin");
  const row = await maybeOne<{
    id: string;
    slug: string;
    name: string;
    portal_enabled: boolean;
  }>(
    t,
    `select id, slug, name, portal_enabled from ${S}.clients
      where slug = $1 and archived_at is null`,
    [slug],
  );
  if (!row) throw notFound("Cliente não encontrado.");
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    portalEnabled: row.portal_enabled,
  };
}

type ContactRow = {
  id: string;
  name: string;
  email: string;
  role: ContactRole;
  access_status: AccessStatus;
  invited_at: Date | string | null;
  consent_at: Date | string | null;
  last_seen_at: Date | string | null;
  pending_until: Date | string | null;
};

const at = (v: Date | string | null) => (v ? iso(v) : null);

export async function listContacts(
  t: TxCtx,
  clientId: string,
): Promise<ContactItem[]> {
  authorize(t.actor, "workspace.admin");
  const rows = await many<ContactRow>(
    t,
    `select c.id, c.name, c.email, c.role, c.access_status::text as access_status,
            c.invited_at, c.consent_at,
            (select max(s.last_seen_at) from ${S}.client_sessions s
              where s.contact_id = c.id) as last_seen_at,
            (select max(l.expires_at) from ${S}.client_access_links l
              where l.contact_id = c.id and l.used_at is null and l.expires_at > now()) as pending_until
       from ${S}.client_contacts c
      where c.client_id = $1
      order by c.name`,
    [clientId],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    accessStatus: r.access_status,
    invitedAt: at(r.invited_at),
    consentAt: at(r.consent_at),
    lastSeenAt: at(r.last_seen_at),
    pendingLinkUntil: at(r.pending_until),
  }));
}

/** Cadastra o contato (sem acesso). Dono e administração. */
export async function createContact(
  t: TxCtx,
  clientId: string,
  raw: z.input<typeof ContactInput>,
): Promise<{ id: string }> {
  authorize(t.actor, "workspace.admin");
  const input = ContactInput.parse(raw);
  const client = await maybeOne<{ id: string }>(
    t,
    `select id from ${S}.clients where id = $1 and archived_at is null`,
    [clientId],
  );
  if (!client) throw notFound("Cliente não encontrado.");
  const taken = await maybeOne(
    t,
    `select 1 from ${S}.client_contacts where client_id = $1 and lower(email) = $2`,
    [clientId, input.email],
  );
  if (taken)
    throw conflict("Já existe um contato com esse e-mail neste cliente.");
  if (
    await maybeOne(
      t,
      `select 1 from ${S}.profiles p
         join ${S}.memberships m on m.profile_id = p.id
        where lower(p.email) = $1 and p.deactivated_at is null`,
      [input.email],
    )
  ) {
    throw unprocessable(TEAM_EMAIL);
  }
  const id = randomUUID();
  await t.tx.query(
    `insert into ${S}.client_contacts (id, workspace_id, client_id, name, email, role)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, t.actor.workspaceId, clientId, input.name, input.email, input.role],
  );
  await audit(t, {
    action: "client_contact.created",
    entityType: "client_contact",
    entityId: id,
    after: { client_id: clientId, name: input.name, role: input.role },
  });
  return { id };
}

type LockedContact = {
  id: string;
  client_id: string;
  name: string;
  email: string;
  profile_id: string | null;
  access_status: AccessStatus;
  client_archived: Date | string | null;
};

async function lockContact(t: TxCtx, contactId: string) {
  authorize(t.actor, "portal.manage");
  if (!Uuid.safeParse(contactId).success)
    throw notFound("Contato não encontrado.");
  const row = await maybeOne<LockedContact>(
    t,
    `select c.id, c.client_id, c.name, c.email, c.profile_id,
            c.access_status::text as access_status, cl.archived_at as client_archived
       from ${S}.client_contacts c
       join ${S}.clients cl on cl.id = c.client_id
      where c.id = $1
      for update of c`,
    [contactId],
  );
  if (!row) throw notFound("Contato não encontrado.");
  return row;
}

/**
 * O perfil do contato (o id dele no portal): o que já existe com o mesmo e-mail (por
 * exemplo, a mesma pessoa como contato de outro cliente), ou um novo. Nunca o perfil de
 * alguém da equipe: o ator do portal tem o id do perfil, e o histórico do contato não
 * pode sair em nome da equipe. O id é gerado aqui porque o perfil novo só fica visível
 * depois de ligado ao contato.
 */
async function ensureProfile(
  t: TxCtx,
  contact: LockedContact,
): Promise<string> {
  const existing = contact.profile_id
    ? { id: contact.profile_id }
    : await maybeOne<{ id: string }>(
        t,
        `select id from ${S}.profiles
          where lower(email) = lower($1) and deactivated_at is null`,
        [contact.email],
      );
  if (
    existing &&
    (await maybeOne(t, `select 1 from ${S}.memberships where profile_id = $1`, [
      existing.id,
    ]))
  ) {
    throw unprocessable(TEAM_EMAIL);
  }
  if (contact.profile_id) return contact.profile_id;
  const profileId = existing?.id ?? randomUUID();
  if (!existing) {
    try {
      await t.tx.query(
        `insert into ${S}.profiles (id, email, full_name) values ($1, $2, $3)`,
        [profileId, contact.email, contact.name],
      );
    } catch {
      throw unprocessable(
        "Esse e-mail já tem um perfil que o Hub não pode usar aqui. Use outro e-mail para este contato.",
      );
    }
  }
  await t.tx.query(
    `update ${S}.client_contacts set profile_id = $2 where id = $1`,
    [contact.id, profileId],
  );
  return profileId;
}

/**
 * Libera o acesso (ou gera um link novo, para quem já tem acesso): o link de uso único,
 * válido por 7 dias, aparece uma vez só. O anterior, se não foi usado, deixa de valer.
 */
export async function issuePortalLink(
  t: TxCtx,
  contactId: string,
  options: { pepper: string; appUrl: string },
): Promise<{ url: string; expiresAt: string; released: boolean }> {
  const contact = await lockContact(t, contactId);
  if (contact.client_archived) {
    throw unprocessable("Cliente arquivado não tem portal.");
  }
  await ensureProfile(t, contact);
  const released =
    contact.access_status === "none" || contact.access_status === "revoked";
  await t.tx.query(
    `update ${S}.client_contacts
        set access_status = case when access_status in ('none', 'revoked') then 'invited'::${S}.access_status
                                 else access_status end,
            invited_at = case when access_status in ('none', 'revoked') then now() else invited_at end,
            invited_by_profile_id = case when access_status in ('none', 'revoked') then $2::uuid
                                         else invited_by_profile_id end
      where id = $1`,
    [contact.id, t.actor.id],
  );
  // O portal do cliente passa a valer (o dono liberou o acesso de um contato dele).
  await t.tx.query(
    `update ${S}.clients set portal_enabled = true where id = $1 and not portal_enabled`,
    [contact.client_id],
  );
  // Um link vivo por contato: o anterior, se não foi usado, deixa de valer.
  await t.tx.query(
    `update ${S}.client_access_links set expires_at = now()
      where contact_id = $1 and used_at is null and expires_at > now()`,
    [contact.id],
  );
  const token = generatePortalToken();
  const expires = await maybeOne<{ expires_at: Date | string }>(
    t,
    `insert into ${S}.client_access_links
       (workspace_id, contact_id, token_hash, purpose, expires_at, created_by_profile_id)
     values ($1, $2, $3, $4, now() + make_interval(days => $5), $6)
     returning expires_at`,
    [
      t.actor.workspaceId,
      contact.id,
      hashPortalToken(token, options.pepper),
      released ? "invite" : "login",
      LINK_DAYS,
      t.actor.id,
    ],
  );
  // O histórico guarda o fato e a validade; nunca o link.
  await audit(t, {
    action: released ? "portal.access_released" : "portal.link_issued",
    entityType: "client_contact",
    entityId: contact.id,
    after: { name: contact.name, expires_at: iso(expires!.expires_at) },
  });
  return {
    url: `${options.appUrl.replace(/\/+$/, "")}/portal/entrar/${token}`,
    expiresAt: iso(expires!.expires_at),
    released,
  };
}

/** Revoga: sessões encerradas e links anulados na hora; o contato volta a não ter acesso. */
export async function revokePortalAccess(
  t: TxCtx,
  contactId: string,
): Promise<void> {
  const contact = await lockContact(t, contactId);
  if (contact.access_status === "revoked" || contact.access_status === "none") {
    return;
  }
  await t.tx.query(
    `update ${S}.client_contacts set access_status = 'revoked' where id = $1`,
    [contact.id],
  );
  await t.tx.query(
    `update ${S}.client_sessions set revoked_at = now()
      where contact_id = $1 and revoked_at is null`,
    [contact.id],
  );
  await t.tx.query(
    `update ${S}.client_access_links set expires_at = now()
      where contact_id = $1 and used_at is null and expires_at > now()`,
    [contact.id],
  );
  await audit(t, {
    action: "portal.access_revoked",
    entityType: "client_contact",
    entityId: contact.id,
    after: { name: contact.name },
  });
}
