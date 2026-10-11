/**
 * Datas iniciais dos marcos que vieram de um modelo: o modelo não tem datas, então os
 * marcos sem data são espalhados por igual entre o início e a entrega do projeto, e o
 * último cai na entrega. Puro (datas AAAA-MM-DD, sem fuso).
 */
export function spreadDueDates(
  start: string,
  target: string,
  count: number,
): string[] {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${target}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  if (count <= 0) return [];
  const days = Math.round((to - from) / 86_400_000);
  return Array.from({ length: count }, (_, i) => {
    const offset = Math.round((days * (i + 1)) / count);
    return new Date(from + offset * 86_400_000).toISOString().slice(0, 10);
  });
}
