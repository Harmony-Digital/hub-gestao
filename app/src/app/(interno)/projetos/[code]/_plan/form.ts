/**
 * Formulários de marco e de frente (camadas estratégica e tática): leitura do que chega
 * do navegador, com mensagens em PT-BR. Sem dependências de servidor, para valer na tela
 * e nos testes. Quem decide o que é permitido continua sendo o serviço.
 */

export const MILESTONE_STATUSES = [
  "planned",
  "in_progress",
  "delivered",
] as const;
export const WORKSTREAM_STATUSES = [
  "planned",
  "in_progress",
  "blocked",
  "done",
] as const;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9]{2,8}$/;
const MILESTONE = /^M[0-9]{1,3}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const RELOAD = "Recarregue a página e tente de novo.";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function line(value: string, max: number, label: string): Parsed<string> {
  const clean = value.trim();
  if (!clean) return { ok: false, message: `Preencha ${label}.` };
  if (clean.length > max || CONTROL.test(clean)) {
    return {
      ok: false,
      message: `${label[0].toUpperCase()}${label.slice(1)}: até ${max} caracteres, numa linha só.`,
    };
  }
  return { ok: true, value: clean };
}

function optionalLine(value: string, max: number): Parsed<string | null> {
  const clean = value.trim();
  if (!clean) return { ok: true, value: null };
  if (clean.length > max || CONTROL.test(clean)) {
    return {
      ok: false,
      message: `Use até ${max} caracteres, numa linha só.`,
    };
  }
  return { ok: true, value: clean };
}

function optionalText(value: string, max: number): Parsed<string | null> {
  const clean = value.replace(/\r\n?/g, "\n").trim();
  if (clean.length > max) {
    return { ok: false, message: `Um dos textos passou de ${max} caracteres.` };
  }
  return { ok: true, value: clean || null };
}

function base(form: FormData): Parsed<{ project: string; id: string | null }> {
  const project = text(form, "project");
  const id = text(form, "id");
  if (!CODE.test(project) || (id && !UUID.test(id))) {
    return { ok: false, message: RELOAD };
  }
  return { ok: true, value: { project, id: id || null } };
}

// Marco -------------------------------------------------------------------------------

export type MilestoneFormValue = {
  project: string;
  id: string | null;
  input: {
    title: string;
    title_client: string | null;
    description_client: string | null;
    due_date: string | null;
    status: (typeof MILESTONE_STATUSES)[number];
    visibility: "internal" | "client";
    acceptance_criteria: { text: string; done: boolean }[];
    date_reason?: string | null;
    /** Só quando a janela mostra a caixa do GATE (marcador gate_section). */
    gate_required?: boolean;
  };
};

/** Critérios chegam como criteria.N.text e criteria.N.done (marcado = "on"). */
function readCriteria(
  form: FormData,
): Parsed<{ text: string; done: boolean }[]> {
  const indexes = [...form.keys()]
    .map((k) => /^criteria\.(\d+)\.text$/.exec(k)?.[1])
    .filter((i): i is string => Boolean(i))
    .map(Number)
    .sort((a, b) => a - b);
  const out: { text: string; done: boolean }[] = [];
  for (const i of [...new Set(indexes)]) {
    const value = text(form, `criteria.${i}.text`).trim();
    if (!value) continue;
    if (value.length > 300 || CONTROL.test(value)) {
      return {
        ok: false,
        message: "Cada critério: até 300 caracteres, numa linha só.",
      };
    }
    out.push({ text: value, done: text(form, `criteria.${i}.done`) === "on" });
  }
  if (out.length > 30) {
    return { ok: false, message: "Use até 30 critérios de aceite por marco." };
  }
  return { ok: true, value: out };
}

export function parseMilestoneForm(form: FormData): Parsed<MilestoneFormValue> {
  const ref = base(form);
  if (!ref.ok) return ref;
  const title = line(text(form, "title"), 200, "o título do marco");
  if (!title.ok) return title;
  const titleClient = optionalLine(text(form, "title_client"), 200);
  if (!titleClient.ok) return titleClient;
  const description = optionalText(text(form, "description_client"), 2000);
  if (!description.ok) return description;
  const due = text(form, "due_date");
  if (due && !DATE.test(due)) {
    return { ok: false, message: "Data inválida. Use o calendário do campo." };
  }
  const status = text(form, "status");
  if (!(MILESTONE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: "Escolha o status do marco." };
  }
  const criteria = readCriteria(form);
  if (!criteria.ok) return criteria;
  const reason = optionalText(text(form, "date_reason"), 500);
  if (!reason.ok) return reason;
  // O portal mostra só o texto escrito para o cliente; nunca cai no título interno.
  const shown = text(form, "client_visible") === "on";
  if (shown && !titleClient.value) {
    return {
      ok: false,
      message: "Para o cliente ver o marco, escreva o título que ele vai ver.",
    };
  }
  return {
    ok: true,
    value: {
      ...ref.value,
      input: {
        title: title.value,
        title_client: titleClient.value,
        description_client: description.value,
        due_date: due || null,
        status: status as MilestoneFormValue["input"]["status"],
        visibility: shown ? "client" : "internal",
        acceptance_criteria: criteria.value,
        ...(ref.value.id ? { date_reason: reason.value } : {}),
        // Caixa desmarcada não vai no formulário: o marcador diz que ela estava na tela.
        ...(form.has("gate_section")
          ? { gate_required: text(form, "gate_required") === "on" }
          : {}),
      },
    },
  };
}

/** Subir ou descer um marco na ordem (RF-09). */
export function parseMoveMilestoneForm(
  form: FormData,
): Parsed<{ id: string; direction: "up" | "down" }> {
  const id = text(form, "id");
  const direction = text(form, "direction");
  if (!UUID.test(id) || (direction !== "up" && direction !== "down")) {
    return { ok: false, message: RELOAD };
  }
  return { ok: true, value: { id, direction } };
}

// Frente ------------------------------------------------------------------------------

export type WorkstreamFormValue = {
  project: string;
  id: string | null;
  fields: {
    title: string;
    milestone: string | null;
    department: string | null;
    status: (typeof WORKSTREAM_STATUSES)[number];
    description_internal: string | null;
    assignee: { type: "user" | "agent"; id: string } | null;
  };
  /** Só quando o formulário traz a parte do cliente (quem pode decidir). */
  visibility: {
    visibility: "internal" | "client";
    title_client: string | null;
    description_client: string | null;
  } | null;
  /**
   * Frentes de que esta depende (ids), só quando o formulário traz a lista (há outras
   * frentes no projeto). Vazia tira todas.
   */
  dependsOn: string[] | null;
};

/** O mesmo limite do serviço (MAX_WORKSTREAM_DEPENDENCIES). */
export const MAX_DEPENDENCIES = 20;

export function parseWorkstreamForm(
  form: FormData,
): Parsed<WorkstreamFormValue> {
  const ref = base(form);
  if (!ref.ok) return ref;
  const title = line(text(form, "title"), 200, "o título da frente");
  if (!title.ok) return title;
  const milestone = text(form, "milestone");
  if (milestone && !MILESTONE.test(milestone)) {
    return { ok: false, message: RELOAD };
  }
  const department = text(form, "department");
  if (department && !SLUG.test(department)) {
    return { ok: false, message: RELOAD };
  }
  const status = text(form, "status");
  if (!(WORKSTREAM_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: "Escolha o status da frente." };
  }
  const description = optionalText(text(form, "description_internal"), 4000);
  if (!description.ok) return description;
  const assigneeRaw = text(form, "assignee");
  let assignee: WorkstreamFormValue["fields"]["assignee"] = null;
  if (assigneeRaw) {
    const m = /^(user|agent):(.+)$/.exec(assigneeRaw);
    if (!m || !UUID.test(m[2])) return { ok: false, message: RELOAD };
    assignee = { type: m[1] as "user" | "agent", id: m[2] };
  }

  let visibility: WorkstreamFormValue["visibility"] = null;
  if (form.has("visibility_section")) {
    const shown = text(form, "client_visible") === "on";
    const titleClient = optionalLine(text(form, "title_client"), 200);
    if (!titleClient.ok) return titleClient;
    const descriptionClient = optionalText(
      text(form, "description_client"),
      2000,
    );
    if (!descriptionClient.ok) return descriptionClient;
    if (shown && !titleClient.value) {
      return {
        ok: false,
        message:
          "Para mostrar a frente ao cliente, escreva o título que ele vai ver.",
      };
    }
    visibility = {
      visibility: shown ? "client" : "internal",
      title_client: titleClient.value,
      description_client: descriptionClient.value,
    };
  }

  let dependsOn: string[] | null = null;
  if (form.has("dependencies_section")) {
    const ids = form
      .getAll("depends_on")
      .filter((v): v is string => typeof v === "string");
    if (
      ids.some((v) => !UUID.test(v)) ||
      (ref.value.id && ids.includes(ref.value.id))
    ) {
      return { ok: false, message: RELOAD };
    }
    dependsOn = [...new Set(ids)];
    if (dependsOn.length > MAX_DEPENDENCIES) {
      return {
        ok: false,
        message: `Escolha até ${MAX_DEPENDENCIES} frentes de que esta depende.`,
      };
    }
  }

  return {
    ok: true,
    value: {
      ...ref.value,
      fields: {
        title: title.value,
        milestone: milestone || null,
        department: department || null,
        status: status as WorkstreamFormValue["fields"]["status"],
        description_internal: description.value,
        assignee,
      },
      visibility,
      dependsOn,
    },
  };
}

/** A frente como está no banco, no formato que a comparação precisa. */
type CurrentWorkstream = {
  title: string;
  milestone: { code: string } | null;
  department: { slug: string } | null;
  status: string;
  description_internal: string | null;
  assignee: { type: string; id: string | null } | null;
  visibility: string;
  title_client: string | null;
  description_client: string | null;
  depends_on: string[];
};

/**
 * O que o formulário mudou de fato. O formulário manda todos os campos; o histórico e a
 * atividade registram só a mudança, e salvar sem mexer em nada não grava nada.
 */
export function workstreamChanges(
  current: CurrentWorkstream,
  value: Pick<WorkstreamFormValue, "fields" | "visibility" | "dependsOn">,
): {
  fields: Partial<WorkstreamFormValue["fields"]>;
  visibility: boolean;
  dependsOn: boolean;
} {
  const f = value.fields;
  const fields: Partial<WorkstreamFormValue["fields"]> = {};
  if (f.title !== current.title) fields.title = f.title;
  if (f.milestone !== (current.milestone?.code ?? null)) {
    fields.milestone = f.milestone;
  }
  if (f.department !== (current.department?.slug ?? null)) {
    fields.department = f.department;
  }
  if (f.status !== current.status) fields.status = f.status;
  if (f.description_internal !== (current.description_internal || null)) {
    fields.description_internal = f.description_internal;
  }
  const who = (a: { type: string; id: string | null } | null) =>
    a ? `${a.type}:${a.id}` : "";
  if (who(f.assignee) !== who(current.assignee)) fields.assignee = f.assignee;

  const v = value.visibility;
  const visibility =
    v !== null &&
    (v.visibility !== current.visibility ||
      v.title_client !== (current.title_client || null) ||
      v.description_client !== (current.description_client || null));
  const wanted = value.dependsOn;
  const dependsOn =
    wanted !== null &&
    (wanted.length !== current.depends_on.length ||
      wanted.some((id) => !current.depends_on.includes(id)));
  return { fields, visibility, dependsOn };
}

// Pedido de aceite --------------------------------------------------------------------

export function parseAcceptanceForm(form: FormData): Parsed<{ id: string }> {
  const id = text(form, "id");
  return UUID.test(id)
    ? { ok: true, value: { id } }
    : { ok: false, message: RELOAD };
}
