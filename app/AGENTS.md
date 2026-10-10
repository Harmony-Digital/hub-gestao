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

## Next.js 16.4 com Cache Components: regras aprendidas neste projeto

- Dados do pedido (`cookies()`, `connection()`, `searchParams`) só dentro de `<Suspense>`. Código que decide algo antes de ler o pedido vira resposta fixa no build: leia `cookies()` ou `connection()` primeiro e confira no `npm run build` se a rota sai como ◐ (e não ○).
- `connection()` vem antes de banco, `Date` e `randomUUID`; o `pageContext()` de `src/lib/ui-context.ts` já faz isso (sem ele, o modo de desenvolvimento acusa "Date.now()"). Fora de um pedido real ele lança erro: nunca em código coberto por testes.
- Componente de cliente com `usePathname()` numa rota dinâmica fica dentro de `<Suspense>`, com um substituto que não leia o endereço.
- `src/proxy.ts` é o antigo middleware. Redirecionamento nele precisa de URL absoluta (`new URL(caminho, request.url)`); a resposta final sai relativa.
- Código só de desenvolvimento (PGlite, login de teste) fica atrás de `process.env.NODE_ENV !== "production"` escrito direto, para o build de produção remover o ramo inteiro.
- Rota nova: os tipos `PageProps<"/rota">` vêm do `next typegen` (o `npm run typecheck` já roda; para um `tsc` avulso, rode `npx next typegen` antes).
- `refresh()` de `next/cache` atualiza a tela depois de uma ação de formulário.
- Lista longa de links de tarefa usa `prefetch={false}`.

## Telas: organização e padrões

- `src/app/(interno)/`: telas da equipe, com a barra lateral de `src/components/shell`. Cada tela confere a sessão de novo perto dos dados (`getCurrentUser`), além da porta do `src/proxy.ts`.
- Projeto: `projetos/[code]/page.tsx` (Visão geral), `lista/` e `quadro/`. O que as três compartilham fica na pasta privada `_tasks/`:
  - `project-header.tsx`: cabeçalho com as abas;
  - `task-panel.tsx` e `panel-frame.tsx`: painel da tarefa (`?tarefa=HUB-n`);
  - `task-forms.tsx` e `new-task.tsx`: formulários e Nova tarefa;
  - `kanban.tsx` e `board-state.ts`: quadro, com `@dnd-kit/core` 6.3.1 em versão fixa;
  - `workstream-filter.tsx` e `params.ts`: filtro por frente e leitura do endereço;
  - `actions.ts` e `form.ts`: ações de formulário e leitura do `FormData`.
- Dados das telas vêm de funções de leitura em `src/modules` (ex.: `modules/tasks/board.ts`, `modules/projects/overview.ts`). Mudanças passam sempre pelos casos de uso, com autorização, auditoria e `source = ui`.
- Ação de formulário:
  - `actionContext()` fica fora do `try`: sem sessão, o redirecionamento para o login não pode ser engolido como erro comum;
  - parser puro e testado do `FormData` (`form.ts`) e caso de uso dentro de `inTx`;
  - `refresh()` no sucesso; erro para a tela por `actionErrorMessage()`, que usa `screenMessage()` (nome do campo em PT-BR);
  - versão velha da tarefa (412) atualiza a tela e avisa.
- Formulário com texto digitado usa `useSubmit` (`onSubmit` + `startTransition`), porque o `<form action>` do React 19 apaga os campos mesmo quando a ação devolve erro.
- Texto livre com links (descrição, comentário, evidência): `Linkified`, que só transforma http e https em link.
- O jsonb do Postgres não guarda a ordem das chaves: texto montado a partir de `before` e `after` do histórico usa ordem fixa (ver `describeTaskEvent`).

## Conferência local

- `npm run dev` (porta 3000) ou, no preview do app Claude, a configuração `hub-gestao` (porta 3100, com `WATCHPACK_POLLING=true`, porque o observador de arquivos do macOS esgota com EMFILE).
- Banco local PGlite em `.data/pglite`, com as migrations e o seed. Com `HUB_DEV_LOGIN=on`, `HUB_DEV_LOGIN_SECRET` (32 caracteres ou mais) e `HUB_DEV_SAMPLE=on` no `.env.local`, o `/login` mostra "Entrar como dono, sem senha (só neste computador)" e o banco local ganha o projeto de exemplo `EXE`.
- Conferir as telas no computador (1440 px) e no celular (375 px), com o console do navegador e o log do servidor limpos.
- Testes de banco com `openTestHub()` (`src/test/hub.ts`): PGlite com migrations, seed, projeto VIT, agentes e chaves criados pelo caminho real.
