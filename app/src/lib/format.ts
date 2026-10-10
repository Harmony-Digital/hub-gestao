/**
 * Datas e nomes para as telas, no fuso da Harmony (D2: America/Sao_Paulo).
 * Datas puras (AAAA-MM-DD) não passam por fuso: são o dia do calendário, como gravado.
 */
const TZ = "America/Sao_Paulo";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-24" → "24/10/2026". */
export function formatDate(isoDate: string | null | undefined): string {
  const m = isoDate ? DATE_ONLY.exec(isoDate) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "2026-10-24" → "24/10". */
export function formatDayMonth(isoDate: string | null | undefined): string {
  const m = isoDate ? DATE_ONLY.exec(isoDate) : null;
  return m ? `${m[3]}/${m[2]}` : "";
}

const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});
const dayFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: TZ,
});
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

/** Hora do dia se for hoje em Brasília; senão o dia ("ontem" para o dia anterior). */
export function formatMoment(timestamp: string, now = new Date()): string {
  const at = new Date(timestamp);
  const day = dayKeyFmt.format(at);
  const today = dayKeyFmt.format(now);
  if (day === today) return timeFmt.format(at);
  const yesterday = dayKeyFmt.format(new Date(now.getTime() - 86_400_000));
  if (day === yesterday) return "ontem";
  return dayFmt.format(at);
}

/** Dia de um instante, em Brasília: "2026-10-10T01:26:16Z" → "09/10". */
export function formatTimestampDay(timestamp: string): string {
  return dayFmt.format(new Date(timestamp));
}

/** Iniciais para avatares: "Fábio Almeida" → "FA"; "Kratos" → "K". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}
