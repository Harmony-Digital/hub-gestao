/**
 * Formulários das Configurações: leitura do que chega do navegador, com mensagens em
 * PT-BR. Puro, para valer nos testes. O resto (quem pode, e-mail repetido) é o serviço.
 */

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RELOAD = "Recarregue a página e tente de novo.";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function line(value: string, max: number, empty: string): Parsed<string> {
  if (!value) return { ok: false, message: empty };
  if (value.length > max || CONTROL.test(value)) {
    return { ok: false, message: `Até ${max} caracteres, numa linha só.` };
  }
  return { ok: true, value };
}

export function parseWorkspaceNameForm(form: FormData): Parsed<string> {
  return line(text(form, "name"), 120, "Dê um nome ao workspace.");
}

export function parseMemberForm(form: FormData): Parsed<{
  name: string;
  email: string;
  role: "member" | "admin";
}> {
  const name = line(text(form, "name"), 120, "Escreva o nome da pessoa.");
  if (!name.ok) return name;
  const email = text(form, "email").toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) {
    return { ok: false, message: "E-mail inválido." };
  }
  const role = text(form, "role");
  if (role !== "member" && role !== "admin") {
    return { ok: false, message: "Escolha o papel da pessoa." };
  }
  return { ok: true, value: { name: name.value, email, role } };
}

export function parseMemberRoleForm(
  form: FormData,
): Parsed<{ profileId: string; role: "member" | "admin" }> {
  const profileId = text(form, "profile_id");
  const role = text(form, "role");
  if (!UUID.test(profileId) || (role !== "member" && role !== "admin")) {
    return { ok: false, message: RELOAD };
  }
  return { ok: true, value: { profileId, role } };
}

export function parseMemberStatusForm(
  form: FormData,
): Parsed<{ profileId: string; status: "active" | "suspended" }> {
  const profileId = text(form, "profile_id");
  const status = text(form, "status");
  if (
    !UUID.test(profileId) ||
    (status !== "active" && status !== "suspended")
  ) {
    return { ok: false, message: RELOAD };
  }
  return { ok: true, value: { profileId, status } };
}

export function parseDepartmentLeadForm(
  form: FormData,
): Parsed<{ departmentId: string; profileId: string | null }> {
  const departmentId = text(form, "department_id");
  const profileId = text(form, "profile_id");
  if (!UUID.test(departmentId) || (profileId && !UUID.test(profileId))) {
    return { ok: false, message: RELOAD };
  }
  return { ok: true, value: { departmentId, profileId: profileId || null } };
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Departamento novo ou editado (RF-27): o nome e a cor (#RRGGBB). */
export function parseDepartmentForm(
  form: FormData,
): Parsed<{ id: string | null; name: string; color: string }> {
  const id = text(form, "department_id");
  if (id && !UUID.test(id)) return { ok: false, message: RELOAD };
  const name = line(text(form, "name"), 80, "Dê um nome ao departamento.");
  if (!name.ok) return name;
  const color = text(form, "color");
  if (!HEX.test(color)) {
    return { ok: false, message: "Escolha a cor do departamento." };
  }
  return {
    ok: true,
    value: { id: id || null, name: name.value, color: color.toUpperCase() },
  };
}

export function parseDepartmentRemoveForm(form: FormData): Parsed<string> {
  const id = text(form, "department_id");
  return UUID.test(id)
    ? { ok: true, value: id }
    : { ok: false, message: RELOAD };
}
