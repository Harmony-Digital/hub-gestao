/**
 * Grade do Calendário do projeto (M7): o mês em semanas de segunda a domingo, com os dias
 * do mês anterior e do seguinte para completar as semanas. Datas puras (AAAA-MM-DD), sem
 * fuso: são dias do calendário. Puro: vale na tela e nos testes.
 */

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-10" válido, senão o mês de hoje (AAAA-MM-DD do workspace). */
export function readMonth(raw: unknown, today: string): string {
  return typeof raw === "string" && MONTH.test(raw) ? raw : today.slice(0, 7);
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** O mês ao lado: shiftMonth("2026-12", 1) = "2027-01". */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** As semanas que cobrem o mês, cada uma com 7 dias (segunda a domingo). */
export function monthWeeks(month: string): string[][] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  // getUTCDay: 0 = domingo. A grade vai da segunda antes do dia 1 ao domingo depois do último.
  const day = new Date(first);
  day.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + ((7 - last.getUTCDay()) % 7));
  const weeks: string[][] = [];
  while (day <= end) {
    if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) {
      weeks.push([]);
    }
    weeks[weeks.length - 1].push(iso(day));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return weeks;
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "2026-10" → "outubro de 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}
