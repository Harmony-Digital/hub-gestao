/**
 * Campos personalizados das tarefas (RF-19), a parte pura: os tipos, os nomes deles e a
 * conferência de cada valor. Vale na tela (componente de cliente importa daqui) e no
 * servidor, que confere de novo antes de gravar.
 */

export const CUSTOM_FIELD_KINDS = [
  "text",
  "number",
  "select",
  "date",
  "url",
] as const;
export type CustomFieldKind = (typeof CUSTOM_FIELD_KINDS)[number];

export const CUSTOM_FIELD_KIND_LABEL: Record<CustomFieldKind, string> = {
  text: "Texto",
  number: "Número",
  select: "Seleção",
  date: "Data",
  url: "Endereço (URL)",
};

export const MAX_FIELDS = 20;
export const MAX_OPTIONS = 30;
export const VALUE_MAX = 500;

type Normalized =
  { ok: true; value: string | null } | { ok: false; message: string };

/**
 * O valor como fica guardado: texto numa linha, número com ponto ("1234.5"), data
 * AAAA-MM-DD, URL http ou https, opção que existe. Vazio tira o valor (null).
 */
export function normalizeFieldValue(
  field: { name: string; kind: CustomFieldKind; options: string[] },
  raw: string | number | null | undefined,
): Normalized {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const text = String(raw).trim();
  if (!text) return { ok: true, value: null };
  const fail = (hint: string): Normalized => ({
    ok: false,
    message: `${field.name}: ${hint}`,
  });
  switch (field.kind) {
    case "text":
      if (text.length > VALUE_MAX || /[\u0000-\u001F\u007F]/.test(text)) {
        return fail(`até ${VALUE_MAX} caracteres, numa linha só.`);
      }
      return { ok: true, value: text };
    case "number": {
      // Aceita "1.234,5" (pt-BR), "1234,5" e "1234.5".
      const pt = /^-?\d{1,3}(\.\d{3})+(,\d+)?$|^-?\d+,\d+$/.test(text);
      const normalized = pt ? text.replace(/\./g, "").replace(",", ".") : text;
      if (!/^-?\d+(\.\d+)?$/.test(normalized) || normalized.length > 30) {
        return fail("escreva um número, como 1250 ou 12,5.");
      }
      return { ok: true, value: String(Number(normalized)) };
    }
    case "date": {
      const time = Date.parse(`${text}T00:00:00Z`);
      const valid =
        /^\d{4}-\d{2}-\d{2}$/.test(text) &&
        !Number.isNaN(time) &&
        new Date(time).toISOString().slice(0, 10) === text;
      return valid
        ? { ok: true, value: text }
        : fail("use o calendário do campo (AAAA-MM-DD).");
    }
    case "url":
      if (!/^https?:\/\/\S+$/i.test(text) || text.length > VALUE_MAX) {
        return fail("o endereço precisa começar com http:// ou https://.");
      }
      return { ok: true, value: text };
    case "select":
      return field.options.includes(text)
        ? { ok: true, value: text }
        : fail(`escolha uma das opções (${field.options.join(", ")}).`);
  }
}

/** "1234.5" vira "1.234,5" na tela; o resto fica como está. */
export function displayFieldValue(
  kind: CustomFieldKind,
  value: string,
): string {
  if (kind === "number" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 6 });
  }
  if (kind === "date") {
    const [y, m, d] = value.split("-");
    return y && m && d ? `${d}/${m}/${y}` : value;
  }
  return value;
}
