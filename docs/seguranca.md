# Segurança do Hub (revisão do M8)

Revisão feita em 2026-10-11, com a produção (`https://hub.harmonydigital.com.br`) e o banco compartilhado (schema `proj_hub_gestao`) conferidos pelos conectores, em modo só leitura. O que mudou no código veio no PR #76; o que depende de decisão do Fábio está marcado.

## Cabeçalhos

| Onde | Cabeçalho | Valor |
|---|---|---|
| Traefik (`deploy/vps/hub-traefik.yaml`) | `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| Traefik | `X-Content-Type-Options` | `nosniff` |
| Traefik | `X-Frame-Options` | `DENY` |
| Traefik | `Referrer-Policy` | `strict-origin-when-cross-origin` |
| Traefik | `X-Robots-Tag` | `noindex, nofollow` |
| App (`src/lib/security-headers.ts`, PR #76) | `Content-Security-Policy` | tudo na própria origem (`default-src 'self'`); `script-src 'self' 'unsafe-inline'`; sem quadro (`frame-src 'none'`, `frame-ancestors 'none'`), sem objeto, `form-action 'self'`, `base-uri 'self'` e `upgrade-insecure-requests` |
| App | `Permissions-Policy` | microfone só na própria origem (ditado do Concierge); câmera, localização, pagamento e USB desligados |
| App | `Cross-Origin-Opener-Policy` | `same-origin` |
| App, só no portal | `X-Robots-Tag`, `Referrer-Policy`, `Cache-Control` | `noindex, nofollow, noarchive`; `no-referrer` (o endereço pode levar o link de uso único); `private, no-store` |

A política de conteúdo não usa nonce: o Next precisa de script inline, e o nonce obrigaria toda página a ser dinâmica (as telas usam Cache Components). O `'unsafe-inline'` em `script-src` é o custo disso. Ele é aceitável porque nenhuma tela carrega script de fora, o Markdown nunca vira HTML cru (`src/components/markdown.tsx`: sem HTML, imagem vira texto, link só http, https e e-mail) e os textos de fora (comentário, descrição, motivo) são mostrados como texto. Em desenvolvimento, a política acrescenta o `eval` do React e o WebSocket do recarregamento. O teste `e2e/seguranca.spec.ts` passa por todas as telas e falha se o navegador recusar alguma coisa.

## Cookies

- **Sessão da equipe** (Supabase): `HttpOnly`, `SameSite=Lax`, `Path=/` e `Secure` em produção (`src/lib/auth/config.ts`).
- **Sessão do portal** (`hub_portal`): `HttpOnly`, `SameSite=Lax`, `Secure` em produção e só em `/portal` (`src/lib/portal/session.ts`). Quem vale é o banco: a sessão é curta e o Sair e o Revogar encerram na hora.
- **Login de teste**: só existe fora de produção. O CI confere que a imagem de produção recusa.

## CORS

A API (`/api/v1`) e o MCP (`/mcp`) não mandam `Access-Control-Allow-Origin`: o navegador de outro site não consegue ler resposta nenhuma. Os agentes chamam de servidor, sem precisar de CORS. Conferido em produção com `Origin: https://evil.example`: o `OPTIONS` responde 204 sem cabeçalho de CORS, e o `GET` responde 401 sem cabeçalho de CORS.

## Limites de pedidos

| Camada | Limite |
|---|---|
| Traefik, por endereço IP | 60 pedidos por segundo em média, com rajada de 120 |
| API e MCP, por chave de agente | 600 por minuto (`HUB_RATE_LIMIT_PER_MIN`); acima disso, 429 com `Retry-After` |
| Login com senha | 20 tentativas por 15 minutos por origem e 8 por e-mail (`src/lib/auth/login.ts`) |
| Link de acesso por e-mail | 3 por 15 minutos por e-mail |
| Portal | link de uso único, aleatório e com validade; guardado só como hash com o pepper |

Os limites da API e do login ficam na memória do processo: o Hub roda num contêiner só (v1). Se um dia rodar em mais de um, eles passam para o banco.

## Banco: RLS e alertas do Supabase

- Toda tabela do schema tem RLS. Há uma política permissiva por tabela e ação, e toda chave estrangeira tem índice. Os três pontos são conferidos a cada mudança de schema (`src/lib/db/schema.test.ts`).
- O teste de vazamento do portal (`src/modules/portal/leak.test.ts`) reprova tabela nova que o cliente consiga ler sem estar na lista de propósito.
- Alertas de segurança do Supabase (`get_advisors`): nenhum no schema do Hub. Os que aparecem são de outros sistemas do Supabase compartilhado e não são mexidos daqui.
- Alertas de desempenho: no schema do Hub, só índices ainda não usados (aviso informativo, normal com pouco dado; eles cobrem as chaves estrangeiras). Nenhuma chave estrangeira sem índice e nenhuma política com função reavaliada linha a linha.

## Papel do banco `hub_gestao_app` (pendência herdada do RELGOV)

Conferido no catálogo do banco compartilhado:

- O papel não é superusuário, não passa por cima de RLS (`bypassrls`), não cria papel nem banco, tem limite de 20 conexões e não pertence a outro papel.
- Lê e escreve só no `proj_hub_gestao`, pelas permissões dadas nas migrations. Não lê nenhuma tabela de outro projeto (`proj_*`).
- **Herdado do padrão do Supabase (permissão para todos, `PUBLIC`):**
  - uso do schema `net` e execução das funções `net.http_get`, `net.http_post` e `net.http_delete` (extensão `pg_net`, que faz o banco chamar endereços na internet);
  - leitura de duas tabelas do `net` e das visões de estatística `pg_stat_statements`.

  O Hub não usa nada disso. Tirar a permissão de `PUBLIC` vale para todos os sistemas do Supabase compartilhado: é decisão do Fábio, depois de conferir que nenhum sistema depende dela. Até lá, o risco fica limitado: só o servidor do Hub conecta com esse papel, e nada que vem de pessoa ou de agente vira SQL (parâmetros sempre separados).

## Segredos

Os segredos ficam só em `/opt/hub-gestao/shared/.env.production` (VPS, `0600`) e `app/.env.local` (computador, fora do git). A lista está em `docs/credenciais.md`. O repositório está público até o fim da construção. A varredura de 2026-10-10 (commits, ramos, PRs, comentários e logs do Actions) achou só valores de teste. A varredura automática de segredos e a proteção de envio do GitHub aguardam a autorização do Fábio.
