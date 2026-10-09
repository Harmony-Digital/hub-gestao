import { badRequest } from "@/lib/errors";

/**
 * Paginação por cursor (PRD §8.3): `?cursor=&limit=`. O cursor guarda a posição da
 * última linha devolvida (data de criação com microssegundos e id), sem expor offset.
 * As consultas devolvem essa data como texto ISO (CURSOR_AT_SQL), porque o Date do
 * JavaScript perde os microssegundos e a paginação pularia ou repetiria linhas.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export type Page<T> = { items: T[]; next_cursor: string | null };

export type CursorPosition = { at: string; id: string };

/** Expressão SQL da posição de uma linha; use `${CURSOR_AT_SQL("t")} as cursor_at`. */
export const CURSOR_AT_SQL = (alias: string) =>
  `to_char(${alias}.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify([position.at, position.id])).toString(
    "base64url",
  );
}

export function decodeCursor(
  cursor: string | null | undefined,
): CursorPosition | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      AT_PATTERN.test(parsed[0]) &&
      typeof parsed[1] === "string" &&
      ID_PATTERN.test(parsed[1])
    ) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch {
    // cai no erro abaixo
  }
  throw badRequest(
    "Cursor inválido. Use o valor de next_cursor da resposta anterior.",
  );
}

export function parseLimit(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return DEFAULT_LIMIT;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw badRequest(`limit precisa ser um inteiro entre 1 e ${MAX_LIMIT}.`);
  }
  return n;
}

/** Recebe até limit + 1 linhas; devolve a página e o cursor da próxima, se houver. */
export function toPage<T, R extends { cursor_at: string; id: string }>(
  rows: R[],
  limit: number,
  map: (row: R) => T,
): Page<T> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    items: pageRows.map(map),
    next_cursor:
      hasMore && last
        ? encodeCursor({ at: last.cursor_at, id: last.id })
        : null,
  };
}
