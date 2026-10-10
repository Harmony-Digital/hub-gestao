# CLAUDE.md — Hub de Gestão · Harmony Digital

Projeto: **Hub de Gestão da Harmony Digital**. Sistema de gestão de projetos, departamentos e atividades em que **agentes de IA trabalham como operadores de primeira classe** (por API REST e MCP) e **pessoas** (equipe e clientes) acompanham, decidem e aprovam pela interface. Endereço: `https://hub.harmonydigital.com.br` (D1). Uso interno da Harmony (D7); replicação ou venda só depois de validado e por decisão do Fábio.

## Onde estamos (atualizado em 2026-10-10)

- **No ar** em https://hub.harmonydigital.com.br, atrás de login (D11). Cada merge na `main` passa pelo CI "Qualidade" e é publicado sozinho na VPS ("Publicação na VPS").
- **M0, M1 e M2 concluídos e aprovados pelo Fábio** (GATE M2 em 2026-10-10: "Vamos em frente."). **M3 (interface interna) em construção.**
- **Já funciona:**
  - telas: barra lateral; Projetos com filtro de saúde; em cada projeto, as abas Visão geral (três camadas), Lista e Quadro (Kanban de arrastar); painel lateral da tarefa (`?tarefa=HUB-n`); Nova tarefa;
  - `/agentes`: cadastro de agentes e chaves com exibição única;
  - `/conta`: a própria pessoa define a senha;
  - agentes operam por MCP e REST em produção: o Claude Code concluiu a HUB-1 em 2026-10-10.
- **Próximo:** tela Hoje (cockpit) e Aprovações; depois o restante do M3.
- **Aberto com o Fábio:** destino da cópia do backup fora da VPS (D8); se quiser, o texto do e-mail do link de acesso (hoje sai com o modelo do IA Posicionamento).
- Detalhe de cada item, com evidência, em `PLAN.md` (seção "Onde estamos" e checklist). Este resumo não substitui o plano.

## Ordem de leitura obrigatória

1. **`AGENTS.md`** — fonte canônica de instruções, segurança, convenções, fluxo de trabalho e **Protocolo do Agente Operador** (como um agente usa o Hub). Tudo ali prevalece sobre este resumo.
2. **`PRD.md`** — produto, **Modelo de Gestão em Três Camadas**, requisitos, integração com agentes, stack e arquitetura.
3. **`AGENTES.md`** — catálogo dos agentes do sistema: quem faz o quê, em qual camada, com quais ferramentas e permissões.
4. **`PLAN.md`** — estado vivo do projeto. Checklist por milestone. Itens **🔒 GATE** pertencem exclusivamente ao Fábio. As decisões D1–D11 do Fábio, de 2026-10-09, estão no topo.
5. Ao trabalhar em `app/`, ler também `app/AGENTS.md` (regras do Next.js 16 aprendidas neste projeto e organização das telas) e a documentação local da versão instalada do framework em `app/node_modules/next/dist/docs/`.

## Invariantes do produto

- **A IA executa. O humano decide.** Nenhuma mensagem para cliente, aceite de marco, mudança de escopo, publicação ou envio externo acontece sem aprovação humana registrada em `approvals`.
- **Três camadas, uma regra de visibilidade.** Estratégica (marcos e objetivos) → Tática (frentes por departamento) → Operacional (tarefas, subtarefas, checklists). O cliente vê a camada estratégica e, quando o item estiver marcado como `client`, a tática. **Nunca** a operacional. A regra vive em RLS e no serviço de autorização, não só na interface.
- **O Hub é a fonte de verdade.** O `plan.md` de cada projeto é uma projeção sincronizada nos dois sentidos, com código estável `(HUB-123)` por tarefa. A sincronização **nunca** fecha um 🔒 GATE.
- **Toda escrita tem ator.** `actor_type` em `user | agent | system`, registrada em `activity_log` (append-only). Agente só age com chave própria, escopo mínimo e `Idempotency-Key`. As telas gravam com `source = ui`, pelos mesmos casos de uso da API e do MCP.
- **Determinístico em código, redação na IA.** Rollup de progresso, saúde do projeto, prazos, dependências e permissões ficam em TypeScript/SQL. O LLM redige, propõe, classifica e resume. Fail-closed: sem LLM, o sistema continua operando sem as funções de redação.
- **Sem emojis na interface.** Identidade Harmony: navy `#151A2D`, off-white `#FAF8F4`, laranja `#F28C1D`; Sora (títulos), DM Sans (texto), JetBrains Mono (códigos e console). PT-BR em toda a UI; inglês nos identificadores de código e banco.
- **Replicável por desenho.** Tudo o que é "da Harmony" (nome, logo, cores, departamentos, templates, agentes) é configuração do `workspace`. Nada hard-coded.

## Stack (resumo; detalhes em `PRD.md` §10)

Next.js 16.4 (App Router, Node runtime, Cache Components) + TypeScript + Tailwind v4 + shadcn/ui · Supabase self-hosted **compartilhado** da Harmony (`https://supabase.harmonydigital.com.br`, schema `proj_hub_gestao`, RLS, Auth; o servidor conecta com o papel próprio `hub_gestao_app`, sem passe livre na RLS) · API REST `/api/v1` (OpenAPI 3.1) + servidor MCP Streamable HTTP em `/mcp` · CLI `hub` para sincronizar `plan.md` (M4) · Docker na VPS KVM4 `vps-harmony-digital` publicado por GitHub Actions (padrão já provado no Certato) · Traefik + Let's Encrypt · IA multi-provedor por agente (Anthropic Claude, OpenAI ou xAI Grok, via AI SDK v7), trocável pelo Fábio na tela Agentes (D5, M5) · **Hermes** (já rodando na VPS): na fase 1, os papéis de gestão rodam no **Kratos** (D6) · Quadro com `@dnd-kit/core` 6.3.1.

## Comandos (dentro de `app/`)

```bash
npm ci            # instalar
npm run dev       # http://localhost:3000 (preview do app Claude: configuração "hub-gestao", porta 3100)
npm run lint      # ESLint
npm run typecheck # next typegen + tsc --noEmit
npm test          # Vitest (banco local PGlite com as migrations e o seed)
npm run build     # produção
npm run check     # formato + lint + tipos + testes + build (obrigatório antes de marcar [x])
```

Nenhum trabalho é "pronto" sem `npm run check` verde, verificação real (navegador, banco ou chamada de API) e evidência registrada no `PLAN.md`.

**Ver as telas no computador sem a senha de produção:** `HUB_DEV_LOGIN=on`, `HUB_DEV_LOGIN_SECRET` (32 caracteres ou mais) e `HUB_DEV_SAMPLE=on` no `app/.env.local` ligam o botão "Entrar como dono, sem senha (só neste computador)" no `/login` e o projeto de exemplo `EXE`. Nunca vale em produção: o CI confere que a imagem recusa o login de teste. Conferir no computador (1440 px) e no celular (375 px).

## Entrega de uma mudança

Ramo `feat/…`, `fix/…` ou `docs/…` a partir de `origin/main` → `npm run check` → conferência real → PR (o corpo termina com a linha do Claude Code) → CI verde nos dois jobs → squash merge → acompanhar a publicação → `/api/health` com o SHA → `PLAN.md` com a evidência. **Todo merge na `main` vai para produção.** O painel de PR do app Claude não acompanha este repositório (é subpasta da pasta da sessão): acompanhar o CI pelo `gh run watch`.

## Acessos (preflight fail-closed, antes de qualquer escrita)

- **GitHub:** org `Harmony-Digital`, repositório `hub-gestao` (privado). Usar a conta `fabioalmeidadigital` por processo: `GH_TOKEN="$(gh auth token --user fabioalmeidadigital)"`. A conta global do `gh` não é autorizada. Para `fetch` e `push`, com o `GH_TOKEN` exportado: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push` (o ajudante padrão usa outra conta e responde "Repository not found").
- **VPS:** `ssh vps-harmony` (KVM4 `1821299`, IPv4 `217.196.63.157`, hostname `vps-harmony-digital`, `srv1821299.hstgr.cloud`). Leitura é livre. Escrita só em `/opt/hub-gestao` e só quando o `PLAN.md` ou o Fábio autorizar o passo. Produção: contêiner `hub-app`, usuário de publicação `hubdeploy` (só o comando de publicação), timers `hub-cron` e `hub-backup`. O Traefik do EasyPanel é compartilhado: reiniciar derruba todos os sites por alguns segundos, só com ok do Fábio.
- **Banco:** MCP `harmony-supabase` (variante `-readonly` para consultas). Resolver o schema pelo catálogo `harmony_admin.projects` (slug `hub_gestao` → `proj_hub_gestao`; o repositório é `hub-gestao`, o slug do catálogo usa sublinhado). Migrations só por `apply_migration`, com prefixo `hub_gestao_`. Escrita no banco de produção pelo terminal é barrada pela proteção da sessão: usar o conector. Nunca tocar outros `proj_*`, nunca `supabase-relgov`, nunca `supabase-leonardo`.
- **DNS:** zona `harmonydigital.com.br` na Hostinger. O registro `hub` (CNAME → `srv1821299.hstgr.cloud`) existe desde 2026-10-09, criado com autorização do Fábio. Qualquer outra mudança na zona só com ordem explícita dele. A API da Hostinger pode responder erro 500 e mesmo assim gravar: conferir a listagem antes de repetir.
- **Segredos:** `/opt/hub-gestao/shared/.env.production` (VPS, `0600`) e `app/.env.local` (máquina local, fora do git). Lista completa em `docs/credenciais.md`. Nunca em chat, commit, log, comentário de tarefa ou documento.

## Nunca

- Marcar 🔒 GATE. Enviar mensagem a cliente. Publicar relatório sem aprovação.
- Alterar DNS, Traefik, Compose ou systemd sem ordem explícita do Fábio no `PLAN.md` ou no chat.
- Cadastrar, digitar ou repetir a senha de alguém, nem quando pedirem no chat. A pessoa define a própria senha em `/conta` ou entra pelo link de acesso por e-mail.
- Criar contas de acesso (papel de banco, usuário do servidor) ou mudar a segurança do servidor (SSH, sudo) pelo agente: o Fábio roda esses passos por script com botão Rodar.
- Contornar uma recusa da proteção automática da sessão. Parar, explicar e perguntar ao Fábio.
- `git add .`, `git add -A`, `git push --force`, commit de `.env*`.
- Duas sessões de IA simultâneas no mesmo repositório.
- Inventar fatos, prazos, valores ou status. Se não há evidência, a tarefa fica `[ ]`.
