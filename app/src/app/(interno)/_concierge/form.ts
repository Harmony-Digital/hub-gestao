import { fromValidationError, screenMessage } from "@/lib/errors";
import {
  ConciergeCommand,
  type ConciergeMeta,
} from "@/modules/concierge/proposal";

/**
 * Leitura do formulário da prévia do Concierge (o que a pessoa confirmou, talvez
 * editado). Puro: o comando sai conferido pelo mesmo esquema que o servidor usa.
 */

export type ParsedConcierge =
  | { ok: true; command: ConciergeCommand; meta: ConciergeMeta }
  | { ok: false; message: string };

const text = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
};

const ASSIGNEE = /^(user|agent):([0-9a-f-]{36})$/i;

/** "", "me", "user:<id>" ou "agent:<id>" → valor do caso de uso (ou undefined). */
function assignee(value: string) {
  if (!value) return undefined;
  if (value === "me") return "me" as const;
  const m = ASSIGNEE.exec(value);
  return m
    ? { type: m[1].toLowerCase() as "user" | "agent", id: m[2] }
    : { type: "user" as const, id: "invalido" };
}

/** Segundos desde o início do pedido (marcado pela tela); fora do razoável, null. */
function secondsSince(started: string, now: number): number | null {
  const start = Number(started);
  if (!Number.isFinite(start) || start <= 0) return null;
  const seconds = Math.round((now - start) / 1000);
  return seconds >= 0 && seconds <= 3600 ? seconds : null;
}

const fail = (message: string): ParsedConcierge => ({ ok: false, message });

export function parseConciergeForm(
  form: FormData,
  now: number = Date.now(),
): ParsedConcierge {
  const meta: ConciergeMeta = {
    edited: text(form, "edited") === "1",
    voice: text(form, "voice") === "1",
    seconds: secondsSince(text(form, "started"), now),
  };
  const kind = text(form, "kind");
  const optional = (name: string) => text(form, name) || undefined;
  let raw: Record<string, unknown>;
  switch (kind) {
    case "create_task": {
      if (!text(form, "project")) return fail("Escolha o projeto.");
      if (!text(form, "title")) return fail("Diga o título da tarefa.");
      raw = {
        kind,
        project: text(form, "project"),
        title: text(form, "title"),
        description_md: optional("description"),
        priority: text(form, "priority") || "normal",
        due_date: optional("due_date"),
        assignee: assignee(text(form, "assignee")),
      };
      break;
    }
    case "update_task": {
      raw = {
        kind,
        task: text(form, "task"),
        version: Number(text(form, "version")),
        status_id: optional("status_id"),
        evidence: optional("evidence"),
        reason: optional("reason"),
        due_date: optional("due_date"),
        priority: optional("priority"),
        assignee: assignee(text(form, "assignee")),
        title: optional("title"),
      };
      break;
    }
    case "comment": {
      if (!text(form, "body")) return fail("Escreva o comentário.");
      raw = { kind, task: text(form, "task"), body_md: text(form, "body") };
      break;
    }
    default:
      return fail("Pedido inválido. Recarregue a página.");
  }
  // Campos vazios saem do objeto (o esquema é estrito e não aceita undefined explícito).
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined) delete raw[key];
  }
  const parsed = ConciergeCommand.safeParse(raw);
  if (!parsed.success) {
    return fail(screenMessage(fromValidationError(parsed.error)));
  }
  return { ok: true, command: parsed.data, meta };
}
