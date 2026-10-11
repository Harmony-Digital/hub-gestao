/**
 * Prazos de retenção (PRD §12), a parte pura: os registros, o padrão e os limites, iguais
 * aos da função `apply_retention` (migração 0027). Vale na tela e nos testes.
 */

export const RETENTION = [
  {
    key: "agent_denials",
    label: "Recusas de acesso dos agentes",
    default: 90,
    min: 30,
    max: 365,
  },
  {
    key: "webhook_deliveries",
    label: "Entregas de webhook já resolvidas",
    default: 30,
    min: 7,
    max: 365,
  },
  {
    key: "jobs_done",
    label: "Jobs concluídos",
    default: 30,
    min: 7,
    max: 365,
  },
  {
    key: "jobs_failed",
    label: "Jobs com falha",
    default: 90,
    min: 30,
    max: 365,
  },
  {
    key: "notifications_read",
    label: "Avisos já lidos da caixa de entrada",
    default: 180,
    min: 30,
    max: 730,
  },
  {
    key: "portal_sessions",
    label: "Sessões e links do portal encerrados",
    default: 90,
    min: 30,
    max: 365,
  },
  {
    key: "agent_runs",
    label: "Chamadas de IA dos agentes (custo e modelo)",
    default: 365,
    min: 90,
    max: 1095,
  },
] as const;

export type RetentionKey = (typeof RETENTION)[number]["key"];
export type RetentionValues = Record<RetentionKey, number>;

/** O valor em vigor: o guardado, dentro dos limites; sem valor válido, o padrão. */
export function effectiveRetention(stored: unknown): RetentionValues {
  const saved =
    stored && typeof stored === "object"
      ? (stored as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    RETENTION.map((r) => {
      const raw = saved[r.key];
      const n =
        typeof raw === "number" && Number.isInteger(raw)
          ? raw
          : typeof raw === "string" && /^[0-9]{1,5}$/.test(raw)
            ? Number(raw)
            : null;
      return [
        r.key,
        n === null ? r.default : Math.min(Math.max(n, r.min), r.max),
      ];
    }),
  ) as RetentionValues;
}
