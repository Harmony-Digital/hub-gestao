/**
 * Leitura dos formulários do editor de status (Editar projeto). Puro: vale na tela e nos
 * testes. Quem decide o que é permitido continua sendo o núcleo (modules/tasks/statuses).
 */

import {
  STATUS_CATEGORIES,
  type StatusCategory,
} from "@/modules/tasks/status-categories";

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9]{2,8}$/;
const COLOR = /^#[0-9A-Fa-f]{6}$/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const RELOAD = "Pedido inválido. Recarregue a página.";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function statusName(value: string): Parsed<string> {
  const name = value.trim();
  if (!name) return { ok: false, message: "Dê um nome ao status." };
  if (name.length > 40 || CONTROL.test(name)) {
    return {
      ok: false,
      message: "O nome do status tem até 40 caracteres, numa linha só.",
    };
  }
  return { ok: true, value: name };
}

function color(value: string): Parsed<string> {
  return COLOR.test(value)
    ? { ok: true, value: value.toUpperCase() }
    : { ok: false, message: "Escolha a cor pelo seletor do campo." };
}

export function parseCreateStatusForm(form: FormData): Parsed<{
  project: string;
  name: string;
  category: StatusCategory;
  color: string;
}> {
  const project = text(form, "project");
  if (!CODE.test(project)) return { ok: false, message: RELOAD };
  const name = statusName(text(form, "name"));
  if (!name.ok) return name;
  const category = text(form, "category");
  if (!(STATUS_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, message: "Escolha a categoria do status." };
  }
  const c = color(text(form, "color"));
  if (!c.ok) return c;
  return {
    ok: true,
    value: {
      project,
      name: name.value,
      category: category as StatusCategory,
      color: c.value,
    },
  };
}

export function parseUpdateStatusForm(form: FormData): Parsed<{
  id: string;
  input: { name?: string; color?: string; make_default?: true };
}> {
  const id = text(form, "id");
  if (!UUID.test(id)) return { ok: false, message: RELOAD };
  if (text(form, "make_default") === "1") {
    return { ok: true, value: { id, input: { make_default: true } } };
  }
  const name = statusName(text(form, "name"));
  if (!name.ok) return name;
  const c = color(text(form, "color"));
  if (!c.ok) return c;
  return {
    ok: true,
    value: { id, input: { name: name.value, color: c.value } },
  };
}

export function parseReorderStatusForm(
  form: FormData,
): Parsed<{ project: string; ids: string[] }> {
  const project = text(form, "project");
  const ids = text(form, "ids").split(",").filter(Boolean);
  if (
    !CODE.test(project) ||
    ids.length === 0 ||
    ids.length > 15 ||
    !ids.every((id) => UUID.test(id))
  ) {
    return { ok: false, message: RELOAD };
  }
  return { ok: true, value: { project, ids } };
}

export function parseRemoveStatusForm(
  form: FormData,
): Parsed<{ id: string; moveTo?: string }> {
  const id = text(form, "id");
  const moveTo = text(form, "move_to");
  if (!UUID.test(id) || (moveTo && !UUID.test(moveTo))) {
    return { ok: false, message: RELOAD };
  }
  return { ok: true, value: { id, ...(moveTo ? { moveTo } : {}) } };
}

/** Ordem nova ao subir (-1) ou descer (+1) um status na lista. */
export function moveInOrder(
  ids: string[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const at = ids.indexOf(id);
  const to = at + delta;
  if (at === -1 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}
