<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Instruções deste app

As instruções canônicas do projeto estão em `../AGENTS.md` e valem integralmente aqui. Em caso de conflito, prevalece o arquivo da raiz. Este arquivo só acrescenta o que é específico do app.

- Antes de escrever código de Next.js, leia o guia correspondente em `node_modules/next/dist/docs/`. Esta versão (16.4) liga Cache Components e pré-carregamento parcial por padrão.
- Rota de API que precisa responder a cada pedido chama `await connection()` antes de ler dados variáveis. Exemplo: `src/app/api/health/route.ts`.
- Lógica testável fica em `src/lib` ou `src/modules`, separada das rotas, com testes `*.test.ts` ao lado.
- Comandos: `npm run dev`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` e `npm run check`, obrigatório antes de marcar `[x]` no `../PLAN.md`.
- Visual: tokens da Harmony em `src/app/globals.css`; componentes base em `src/components/ui` (shadcn com Radix). Sem emojis na interface. Textos em PT-BR.
- Segredos nunca entram no código. O modelo de variáveis está em `.env.example`; valores locais ficam em `.env.local`.
