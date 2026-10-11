/**
 * Formulários de cadastro (projeto e cliente): leitura do que chega do navegador, com
 * mensagens em PT-BR. Sem dependências de servidor, para valer na tela e nos testes.
 * Quem decide o que é permitido continua sendo o serviço (src/modules/projects/admin.ts).
 */

export const PHASES = ["descobrir", "validar", "escalar"] as const;
export const EDITABLE_STATUSES = [
  "discovery",
  "active",
  "paused",
  "delivered",
] as const;

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9]{2,8}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
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

function optionalText(value: string, max: number): Parsed<string | null> {
  const clean = value.replace(/\r\n?/g, "\n").trim();
  if (clean.length > max) {
    return { ok: false, message: `Um dos textos passou de ${max} caracteres.` };
  }
  return { ok: true, value: clean || null };
}

function optionalDate(value: string): Parsed<string | null> {
  if (!value) return { ok: true, value: null };
  return DATE.test(value)
    ? { ok: true, value }
    : { ok: false, message: "Data inválida. Use o calendário do campo." };
}

function optionalId(value: string): Parsed<string | null> {
  if (!value) return { ok: true, value: null };
  return UUID.test(value)
    ? { ok: true, value }
    : { ok: false, message: RELOAD };
}

export type ProjectFormValue = {
  mode: "create" | "edit";
  /** Código novo (criação) ou o código do projeto editado. */
  code: string;
  /** Cliente escolhido, ou null quando o formulário pede um cliente novo. */
  clientId: string | null;
  newClientName: string | null;
  expectedUpdatedAt: string | null;
  /** Modelo escolhido na criação (id), ou null. */
  template: string | null;
  fields: {
    name: string;
    phase: (typeof PHASES)[number];
    status: (typeof EDITABLE_STATUSES)[number];
    objective_internal: string | null;
    objective_client: string | null;
    start_date: string | null;
    target_date: string | null;
    owner_profile_id: string | null;
    pm_agent_id: string | null;
    repo_url: string | null;
    plan_path: string | null;
    require_evidence: boolean;
    client_can_confirm_receipt: boolean;
    email_client_reports: boolean;
    departments: string[];
  };
};

export function parseProjectForm(form: FormData): Parsed<ProjectFormValue> {
  const mode = text(form, "mode") === "edit" ? "edit" : "create";
  const code = text(form, "code").trim().toUpperCase();
  if (!CODE.test(code)) {
    return {
      ok: false,
      message:
        "O código tem de 2 a 8 letras maiúsculas ou números, sem espaço, como CLI ou EXE2.",
    };
  }
  const name = line(text(form, "name"), 160, "o nome do projeto");
  if (!name.ok) return name;

  const client = text(form, "client");
  let clientId: string | null = null;
  let newClientName: string | null = null;
  if (client === "novo") {
    const parsed = line(
      text(form, "new_client_name"),
      160,
      "o nome do cliente novo",
    );
    if (!parsed.ok) return parsed;
    newClientName = parsed.value;
  } else if (UUID.test(client)) {
    clientId = client;
  } else {
    return { ok: false, message: "Escolha o cliente do projeto." };
  }

  const phase = text(form, "phase");
  if (!(PHASES as readonly string[]).includes(phase)) {
    return { ok: false, message: "Escolha a fase do projeto." };
  }
  const status = text(form, "status");
  if (!(EDITABLE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: "Escolha o status do projeto." };
  }

  const objectiveInternal = optionalText(
    text(form, "objective_internal"),
    4000,
  );
  if (!objectiveInternal.ok) return objectiveInternal;
  const objectiveClient = optionalText(text(form, "objective_client"), 2000);
  if (!objectiveClient.ok) return objectiveClient;
  const start = optionalDate(text(form, "start_date"));
  if (!start.ok) return start;
  const target = optionalDate(text(form, "target_date"));
  if (!target.ok) return target;
  if (start.value && target.value && target.value < start.value) {
    return {
      ok: false,
      message: "A previsão de entrega não pode ser antes do início.",
    };
  }
  const owner = optionalId(text(form, "owner_profile_id"));
  if (!owner.ok) return owner;
  const agent = optionalId(text(form, "pm_agent_id"));
  if (!agent.ok) return agent;

  const repo = text(form, "repo_url").trim();
  if (repo && (!/^https:\/\/\S+$/.test(repo) || repo.length > 500)) {
    return {
      ok: false,
      message: "O repositório precisa ser um endereço que comece com https://.",
    };
  }
  const planPath = text(form, "plan_path").trim();
  if (planPath && (planPath.length > 300 || CONTROL.test(planPath))) {
    return { ok: false, message: "O caminho do plan.md: até 300 caracteres." };
  }

  const departments = [
    ...new Set(
      form
        .getAll("department")
        .filter((v): v is string => typeof v === "string" && SLUG.test(v)),
    ),
  ];
  const updatedAt = text(form, "updated_at");
  const template = text(form, "template");
  if (template && !UUID.test(template)) {
    return { ok: false, message: "Recarregue a página e tente de novo." };
  }

  return {
    ok: true,
    value: {
      mode,
      code,
      clientId,
      newClientName,
      expectedUpdatedAt: mode === "edit" && updatedAt ? updatedAt : null,
      template: mode === "create" && template ? template : null,
      fields: {
        name: name.value,
        phase: phase as ProjectFormValue["fields"]["phase"],
        status: status as ProjectFormValue["fields"]["status"],
        objective_internal: objectiveInternal.value,
        objective_client: objectiveClient.value,
        start_date: start.value,
        target_date: target.value,
        owner_profile_id: owner.value,
        pm_agent_id: agent.value,
        repo_url: repo || null,
        plan_path: planPath || null,
        require_evidence: text(form, "require_evidence") === "on",
        client_can_confirm_receipt:
          text(form, "client_can_confirm_receipt") === "on",
        email_client_reports: text(form, "email_client_reports") === "on",
        departments,
      },
    },
  };
}

export function parseClientForm(form: FormData): Parsed<{
  id: string | null;
  name: string;
  segment: string | null;
  notes_internal: string | null;
  accent_color: string | null;
}> {
  const rawId = text(form, "id");
  if (rawId && !UUID.test(rawId)) return { ok: false, message: RELOAD };
  const name = line(text(form, "name"), 160, "o nome do cliente");
  if (!name.ok) return name;
  const segment = text(form, "segment").trim();
  if (segment.length > 120 || CONTROL.test(segment)) {
    return {
      ok: false,
      message: "O segmento: até 120 caracteres, numa linha só.",
    };
  }
  const notes = optionalText(text(form, "notes_internal"), 4000);
  if (!notes.ok) return notes;
  const accent = text(form, "accent_color").trim();
  if (accent && !/^#[0-9A-Fa-f]{6}$/.test(accent)) {
    return {
      ok: false,
      message:
        "A cor de destaque: use o código da cor com # e seis caracteres, como #2E7D6B.",
    };
  }
  return {
    ok: true,
    value: {
      id: rawId || null,
      name: name.value,
      segment: segment || null,
      notes_internal: notes.value,
      accent_color: accent ? accent.toUpperCase() : null,
    },
  };
}
