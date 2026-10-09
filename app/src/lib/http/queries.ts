/**
 * Conversão dos parâmetros de consulta (texto) para os filtros tipados dos módulos.
 * Valores que não são do tipo esperado seguem como estão, para o zod apontar o erro.
 */

function bool(value: string | undefined): boolean | string | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function int(value: string | undefined): number | string | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

export function taskFilterFromQuery(raw: Record<string, string>): unknown {
  const { status_category, blocked, limit, ...rest } = raw;
  return {
    ...rest,
    ...(status_category !== undefined
      ? {
          status_category: status_category
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
    ...(blocked !== undefined ? { blocked: bool(blocked) } : {}),
    ...(limit !== undefined ? { limit: int(limit) } : {}),
  };
}

export function approvalFilterFromQuery(raw: Record<string, string>): unknown {
  const { mine, ...rest } = raw;
  return { ...rest, ...(mine !== undefined ? { mine: bool(mine) } : {}) };
}
