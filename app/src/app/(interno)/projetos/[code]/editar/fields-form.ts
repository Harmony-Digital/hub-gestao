/**
 * Formulários dos campos personalizados das tarefas (Editar projeto): leitura do que chega
 * do navegador, com mensagens em PT-BR. Puro, para valer na tela e nos testes. Quem
 * confere o resto (nome repetido, opção em uso, limite) é o serviço.
 */

import {
  CUSTOM_FIELD_KINDS,
  MAX_OPTIONS,
  type CustomFieldKind,
} from "@/modules/tasks/custom-field-kinds";

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9]{2,8}$/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const RELOAD = "Recarregue a página e tente de novo.";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function name(value: string): Parsed<string> {
  const clean = value.trim();
  if (!clean) return { ok: false, message: "Dê um nome ao campo." };
  if (clean.length > 60 || CONTROL.test(clean)) {
    return {
      ok: false,
      message: "Nome do campo: até 60 caracteres, numa linha só.",
    };
  }
  return { ok: true, value: clean };
}

/** Opções da seleção: uma por linha, sem repetir. */
function options(value: string): Parsed<string[]> {
  const list = [
    ...new Set(
      value
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  ];
  if (list.length > MAX_OPTIONS) {
    return { ok: false, message: `Até ${MAX_OPTIONS} opções.` };
  }
  if (list.some((o) => o.length > 60)) {
    return { ok: false, message: "Cada opção: até 60 caracteres." };
  }
  return { ok: true, value: list };
}

export function parseCreateFieldForm(form: FormData): Parsed<{
  project: string;
  name: string;
  kind: CustomFieldKind;
  options: string[];
}> {
  const project = text(form, "project");
  if (!CODE.test(project)) return { ok: false, message: RELOAD };
  const n = name(text(form, "name"));
  if (!n.ok) return n;
  const kind = text(form, "kind");
  if (!(CUSTOM_FIELD_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, message: "Escolha o tipo do campo." };
  }
  const o = options(text(form, "options"));
  if (!o.ok) return o;
  if (kind === "select" && o.value.length === 0) {
    return {
      ok: false,
      message: "Escreva as opções da seleção, uma por linha.",
    };
  }
  return {
    ok: true,
    value: {
      project,
      name: n.value,
      kind: kind as CustomFieldKind,
      options: kind === "select" ? o.value : [],
    },
  };
}

export function parseUpdateFieldForm(
  form: FormData,
): Parsed<{ id: string; name: string; options: string[] }> {
  const id = text(form, "id");
  if (!UUID.test(id)) return { ok: false, message: RELOAD };
  const n = name(text(form, "name"));
  if (!n.ok) return n;
  const o = options(text(form, "options"));
  if (!o.ok) return o;
  return { ok: true, value: { id, name: n.value, options: o.value } };
}

export function parseRemoveFieldForm(form: FormData): Parsed<{ id: string }> {
  const id = text(form, "id");
  return UUID.test(id)
    ? { ok: true, value: { id } }
    : { ok: false, message: RELOAD };
}
