/**
 * Duração em minutos, do jeito que se escreve: "90", "1h", "1h30", "1h 30min", "1:30",
 * "1,5h", "45 min". Puro, para valer na tela e nos testes.
 */

/** Minutos da duração escrita; null para vazio; "invalida" para o que não dá para ler. */
export function parseDuration(text: string): number | null | "invalida" {
  const value = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!value) return null;
  // Só número: minutos.
  if (/^\d{1,5}$/.test(value)) return Number(value);
  // 1:30 (horas e minutos).
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(value);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  // 1,5h ou 1.5 h (horas com decimal).
  const decimal = /^(\d{1,3})[.,](\d{1,2}) ?h(?:oras?)?$/.exec(value);
  if (decimal) {
    return Math.round(Number(`${decimal[1]}.${decimal[2]}`) * 60);
  }
  // 1h, 1h30, 1h 30min, 2 horas e 15 minutos, 45 min.
  const parts =
    /^(?:(\d{1,3}) ?h(?:oras?)?)?(?:,? ?e? ?(\d{1,3}) ?(?:m|min|mins|minutos?)?)?$/.exec(
      value,
    );
  if (parts && (parts[1] !== undefined || parts[2] !== undefined)) {
    // "45" sozinho já foi lido acima; aqui "45 min", "1h", "1h30".
    if (parts[1] === undefined && !/m/.test(value)) return "invalida";
    return Number(parts[1] ?? 0) * 60 + Number(parts[2] ?? 0);
  }
  return "invalida";
}

/** "45 min", "1h", "1h30", "12h05". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, "0")}`;
}
