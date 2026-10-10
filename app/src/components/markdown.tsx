import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Só endereços web e e-mail viram link; o resto (javascript:, data:…) é descartado. */
function safeUrl(url: string): string {
  return /^(https?:|mailto:)/i.test(url) ? url : "";
}

/**
 * Markdown de comentários e descrições (pessoas e agentes escrevem em Markdown). Sem HTML
 * cru; links abrem em outra aba. Vale na tela do servidor e na pré-visualização.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="hub-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrl}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (
            <span>{alt ? `[imagem: ${alt}]` : "[imagem]"}</span>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
