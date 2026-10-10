import { splitLinks } from "@/lib/links";

/** Texto livre com os endereços http(s) clicáveis, abrindo em outra aba. */
export function Linkified({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((part, i) =>
        part.type === "link" ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-info-fg underline underline-offset-2 hover:text-navy"
          >
            {part.href}
          </a>
        ) : (
          part.value
        ),
      )}
    </>
  );
}
