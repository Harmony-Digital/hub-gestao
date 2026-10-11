/**
 * Pessoas no projeto (RF-03): leitura do formulário, pura. Quem pode e quem é da equipe é
 * o núcleo (`modules/projects/members.ts`).
 */

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const CODE = /^[A-Z0-9]{2,8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["lead", "member", "guest"] as const;
const RELOAD = "Recarregue a página e tente de novo.";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function parseMemberForm(form: FormData): Parsed<{
  project: string;
  profileId: string;
  role: (typeof ROLES)[number];
}> {
  const project = text(form, "project");
  const profileId = text(form, "profile_id");
  const role = text(form, "role");
  if (!CODE.test(project)) return { ok: false, message: RELOAD };
  if (!UUID.test(profileId)) {
    return { ok: false, message: "Escolha a pessoa." };
  }
  if (!(ROLES as readonly string[]).includes(role)) {
    return { ok: false, message: "Escolha o papel no projeto." };
  }
  return {
    ok: true,
    value: { project, profileId, role: role as (typeof ROLES)[number] },
  };
}

export function parseMemberRemoveForm(
  form: FormData,
): Parsed<{ project: string; profileId: string }> {
  const project = text(form, "project");
  const profileId = text(form, "profile_id");
  if (!CODE.test(project) || !UUID.test(profileId)) {
    return { ok: false, message: RELOAD };
  }
  return { ok: true, value: { project, profileId } };
}
