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

const longDateFmt = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ,
});
const hourFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hourCycle: "h23",
  timeZone: TZ,
});

/** O dia de hoje em Brasília (AAAA-MM-DD), para comparar com prazos. */
export function todayKey(now: Date): string {
  return dayKeyFmt.format(now);
}

/** Data por extenso em Brasília, com inicial maiúscula: "Sábado, 10 de outubro". */
export function formatLongDate(now: Date): string {
  const text = longDateFmt.format(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Saudação pela hora de Brasília: "Bom dia" até 12h, "Boa tarde" até 18h, depois "Boa noite". */
export function greetingFor(now: Date): string {
  const hour = Number(hourFmt.format(now));
  return hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
}

/** Há quanto tempo, no fuso de Brasília: "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias", depois o dia. */
export function formatAge(timestamp: string, now = new Date()): string {
  const at = new Date(timestamp);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const day = dayKeyFmt.format(at);
  const today = dayKeyFmt.format(now);
  if (day === today) return `há ${Math.floor(minutes / 60)} h`;
  const yesterday = dayKeyFmt.format(new Date(now.getTime() - 86_400_000));
  if (day === yesterday) return "ontem";
  const days = Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000);
  return days < 7 ? `há ${days} dias` : dayFmt.format(at);
}

/** Dia de um instante, em Brasília: "2026-10-10T01:26:16Z" → "09/10". */
export function formatTimestampDay(timestamp: string): string {
  return dayFmt.format(new Date(timestamp));
}

const fullDayFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: TZ,
});

/** Data completa de um instante, em Brasília: "2026-10-10T01:26:16Z" → "09/10/2026". */
export function formatTimestampDate(timestamp: string): string {
  return fullDayFmt.format(new Date(timestamp));
}

/** Iniciais para avatares: "Fábio Almeida" → "FA"; "Kratos" → "K". */
export function initials(name: string | null | undefined): string {
  // Só palavras que começam com letra: "Codex (exemplo)" → "C", não "C(".
  const words = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w));
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Tamanho de arquivo em PT-BR: "820 bytes", "320 KB", "1,2 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}
