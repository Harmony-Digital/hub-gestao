/**
 * Formulário de modelo de projeto: leitura do que chega do navegador, com mensagens em
 * PT-BR. Sem dependências de servidor, para valer na tela e nos testes. Quem confere o
 * esqueleto (marco, tarefa, sem código, sem caixa marcada) é o serviço.
 */

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const CODE = /^[A-Z0-9]{2,8}$/;
const RELOAD = "Recarregue a página e tente de novo.";
export const MARKDOWN_MAX = 60_000;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export type TemplateFormValue = {
  id: string | null;
  input: {
    name: string;
    description: string | null;
    markdown: string;
    departments: string[];
  };
};

export function parseTemplateForm(form: FormData): Parsed<TemplateFormValue> {
  const id = text(form, "id");
  if (id && !UUID.test(id)) return { ok: false, message: RELOAD };
  const name = text(form, "name").trim();
  if (!name) return { ok: false, message: "Dê um nome ao modelo." };
  if (name.length > 120 || CONTROL.test(name)) {
    return {
      ok: false,
      message: "Nome do modelo: até 120 caracteres, numa linha só.",
    };
  }
  const description = text(form, "description").replace(/\r\n?/g, "\n").trim();
  if (description.length > 1000) {
    return { ok: false, message: "Descrição: até 1.000 caracteres." };
  }
  const markdown = text(form, "markdown").replace(/\r\n?/g, "\n");
  if (!markdown.trim()) {
    return { ok: false, message: "Escreva o esqueleto do modelo." };
  }
  if (markdown.length > MARKDOWN_MAX) {
    return {
      ok: false,
      message: `O esqueleto passou de ${MARKDOWN_MAX.toLocaleString("pt-BR")} caracteres.`,
    };
  }
  const departments = form
    .getAll("departments")
    .filter((v): v is string => typeof v === "string");
  if (departments.some((d) => !SLUG.test(d))) {
    return { ok: false, message: RELOAD };
  }
  return {
    ok: true,
    value: {
      id: id || null,
      input: {
        name,
        description: description || null,
        markdown: `${markdown.trimEnd()}\n`,
        departments: [...new Set(departments)],
      },
    },
  };
}

/** Salvar um projeto como modelo: só o nome e a descrição. */
export function parseProjectTemplateForm(
  form: FormData,
): Parsed<{ project: string; name: string; description: string | null }> {
  const project = text(form, "project");
  if (!CODE.test(project)) return { ok: false, message: RELOAD };
  const name = text(form, "name").trim();
  if (!name) return { ok: false, message: "Dê um nome ao modelo." };
  if (name.length > 120 || CONTROL.test(name)) {
    return {
      ok: false,
      message: "Nome do modelo: até 120 caracteres, numa linha só.",
    };
  }
  const description = text(form, "description").trim();
  if (description.length > 1000) {
    return { ok: false, message: "Descrição: até 1.000 caracteres." };
  }
  return {
    ok: true,
    value: { project, name, description: description || null },
  };
}

export function parseRemoveTemplateForm(
  form: FormData,
): Parsed<{ id: string }> {
  const id = text(form, "id");
  return UUID.test(id)
    ? { ok: true, value: { id } }
    : { ok: false, message: RELOAD };
}
