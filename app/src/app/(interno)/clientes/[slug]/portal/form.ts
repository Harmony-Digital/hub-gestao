import type { ContactRole } from "@/modules/portal/access";

/** Formulários dos contatos e do acesso ao portal: leitura pura do que vem da tela. */

export type PortalFormState =
  | { status: "idle" }
  | { status: "error"; message: string }
  /** O link de uso único aparece uma vez só, logo depois de gerado, com o convite. */
  | { status: "ok"; message: string; link?: string; invite?: string };

export const PORTAL_IDLE: PortalFormState = { status: "idle" };

/** O que o contato pode fazer no portal (PRD §5): o aceite de marco é sempre do dono. */
export const ROLE_LABEL: Record<ContactRole, string> = {
  client_viewer: "Acompanha os projetos",
  client_approver: "Decisor: também confirma o recebimento de marcos",
};

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseContactForm(form: FormData): Parsed<{
  clientId: string;
  name: string;
  email: string;
  role: ContactRole;
}> {
  const clientId = String(form.get("client_id") ?? "");
  if (!UUID.test(clientId)) {
    return { ok: false, message: "Cliente inválido. Recarregue a página." };
  }
  const name = String(form.get("name") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return { ok: false, message: "Diga o nome do contato." };
  if (name.length > 120) {
    return { ok: false, message: "O nome passou de 120 caracteres." };
  }
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false, message: "Confira o e-mail do contato." };
  }
  const role = String(form.get("role") ?? "");
  if (role !== "client_viewer" && role !== "client_approver") {
    return { ok: false, message: "Escolha o que o contato pode fazer." };
  }
  return { ok: true, value: { clientId, name, email, role } };
}

export function parseContactIdForm(form: FormData): Parsed<string> {
  const id = String(form.get("contact_id") ?? "");
  return UUID.test(id)
    ? { ok: true, value: id }
    : { ok: false, message: "Contato inválido. Recarregue a página." };
}
