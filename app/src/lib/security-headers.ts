/**
 * Cabeçalhos de segurança do app (M8). O Traefik da VPS já manda HSTS, nosniff,
 * X-Frame-Options e Referrer-Policy (`deploy/vps/hub-traefik.yaml`); aqui ficam os que só o
 * app sabe montar: a política de conteúdo (CSP), as permissões do navegador e o isolamento
 * da janela.
 *
 * Sem nonce: o Next precisa de script inline e as telas usam Cache Components (o nonce
 * obrigaria toda página a ser dinâmica). Por isso `script-src` leva 'unsafe-inline'; o
 * resto fica fechado na própria origem (nenhuma tela carrega script, imagem, fonte ou
 * quadro de fora), e o Markdown nunca vira HTML cru. Em desenvolvimento, o React precisa
 * de 'unsafe-eval' e o recarregamento ao vivo, de WebSocket.
 */

export type HeaderMode = "development" | "production";

export function contentSecurityPolicy(mode: HeaderMode): string {
  const dev = mode === "development";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "media-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!dev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** Microfone só para o ditado do Concierge (na própria origem); o resto, desligado. */
export const PERMISSIONS_POLICY =
  "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()";

export function securityHeaders(
  mode: HeaderMode,
): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(mode) },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
