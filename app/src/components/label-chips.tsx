/**
 * Etiquetas de uma tarefa (RF-18): o ponto com a cor e o nome em texto da marca (a cor
 * nunca carrega o texto, para o contraste valer em qualquer cor e nos dois temas). Mostra
 * até `max` e diz quantas sobram.
 */
export function LabelChips({
  labels,
  max = 3,
  className = "",
}: {
  labels: { name: string; color: string }[];
  max?: number;
  className?: string;
}) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const rest = labels.length - shown.length;
  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`}>
      {shown.map((l) => (
        <span
          key={l.name}
          className="inline-flex max-w-40 items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-xs leading-4 text-ink-2"
        >
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: l.color }}
          />
          <span className="truncate">{l.name}</span>
        </span>
      ))}
      {rest > 0 ? (
        <span className="text-xs text-caption">
          +{rest}
          <span className="sr-only"> etiquetas</span>
        </span>
      ) : null}
    </span>
  );
}
