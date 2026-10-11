import { Markdown } from "@/components/markdown";
import { formatMoment } from "@/lib/format";
import type { ChannelMessage } from "@/modules/comments/client-channel";

/**
 * A conversa do canal do cliente, igual na tela da equipe e no portal: quem escreveu, de
 * que lado (cliente ou equipe), quando e o texto em Markdown seguro.
 */
export function ChannelThread({
  messages,
  clientLabel,
  teamLabel,
  empty,
}: {
  messages: ChannelMessage[];
  clientLabel: string;
  teamLabel: string;
  empty: string;
}) {
  if (messages.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-2">
        {empty}
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => (
        <li
          key={m.id}
          className={`flex flex-col gap-1.5 rounded-xl border p-3 ${
            m.fromClient
              ? "border-line bg-card"
              : "border-brand/30 bg-brand-soft/10"
          }`}
        >
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span className="font-semibold break-words text-navy">
              {m.author}
            </span>
            <span className="text-caption">
              {m.fromClient ? clientLabel : teamLabel}
            </span>
            <time dateTime={m.at} className="ml-auto text-xs text-caption">
              {formatMoment(m.at)}
            </time>
          </p>
          <div className="text-ink">
            <Markdown text={m.bodyMd} />
          </div>
        </li>
      ))}
    </ol>
  );
}
