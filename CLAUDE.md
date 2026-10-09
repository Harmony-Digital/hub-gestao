# CLAUDE.md — Hub de Gestão · Harmony Digital

Projeto: **Hub de Gestão da Harmony Digital**. Sistema de gestão de projetos, departamentos e atividades em que **agentes de IA trabalham como operadores de primeira classe** (por API REST e MCP) e **pessoas** (equipe e clientes) acompanham, decidem e aprovam pela interface. Endereço: `https://hub.harmonydigital.com.br` (D1). Uso interno da Harmony (D7); replicação ou venda só depois de validado e por decisão do Fábio.

## Ordem de leitura obrigatória

1. **`AGENTS.md`** — fonte canônica de instruções, segurança, convenções, fluxo de trabalho e **Protocolo do Agente Operador** (como um agente usa o Hub). Tudo ali prevalece sobre este resumo.
2. **`PRD.md`** — produto, **Modelo de Gestão em Três Camadas**, requisitos, integração com agentes, stack e arquitetura.
3. **`AGENTES.md`** — catálogo dos agentes do sistema: quem faz o quê, em qual camada, com quais ferramentas e permissões.
4. **`PLAN.md`** — estado vivo do projeto. Checklist por milestone. Itens **🔒 GATE** pertencem exclusivamente ao Fábio. As decisões D1–D11 do Fábio, de 2026-10-09, estão no topo.
5. Ao trabalhar em `app/`, ler também `app/AGENTS.md` (quando existir) e a documentação local da versão instalada do framework em `app/node_modules/next/dist/docs/`.

## Invariantes do produto

- **A IA executa. O humano decide.** Nenhuma mensagem para cliente, aceite de marco, mudança de escopo, publicação ou envio externo acontece sem aprovação humana registrada em `approvals`.
- **Três camadas, uma regra de visibilidade.** Estratégica (marcos e objetivos) → Tática (frentes por departamento) → Operacional (tarefas, subtarefas, checklists). O cliente vê a camada estratégica e, quando o item estiver marcado como `client`, a tática. **Nunca** a operacional. A regra vive em RLS e no serviço de autorização, não só na interface.
- **O Hub é a fonte de verdade.** O `plan.md` de cada projeto é uma projeção sincronizada nos dois sentidos, com código estável `(HUB-123)` por tarefa. A sincronização **nunca** fecha um 🔒 GATE.
- **Toda escrita tem ator.** `actor_type` em `user | agent | system`, registrada em `activity_log` (append-only). Agente só age com chave própria, escopo mínimo e `Idempotency-Key`.
- **Determinístico em código, redação na IA.** Rollup de progresso, saúde do projeto, prazos, dependências e permissões ficam em TypeScript/SQL. O LLM redige, propõe, classifica e resume. Fail-closed: sem LLM, o sistema continua operando sem as funções de redação.
- **Sem emojis na interface.** Identidade Harmony: navy `#151A2D`, off-white `#FAF8F4`, laranja `#F28C1D`; Sora (títulos), DM Sans (texto), JetBrains Mono (códigos e console). PT-BR em toda a UI; inglês nos identificadores de código e banco.
- **Replicável por desenho.** Tudo o que é "da Harmony" (nome, logo, cores, departamentos, templates, agentes) é configuração do `workspace`. Nada hard-coded.

## Stack (resumo; detalhes em `PRD.md` §10)

Next.js 16 (App Router, Node runtime) + TypeScript + Tailwind v4 + shadcn/ui · Supabase self-hosted **compartilhado** da Harmony (`https://supabase.harmonydigital.com.br`, schema `proj_hub_gestao`, RLS, Auth, Storage, Realtime) · API REST `/api/v1` (OpenAPI 3.1) + servidor MCP Streamable HTTP em `/mcp` · CLI `hub` para sincronizar `plan.md` · Docker na VPS KVM4 `vps-harmony-digital` publicado por GitHub Actions (padrão já provado no RELGOV) · Traefik + Let's Encrypt · IA multi-provedor por agente (Anthropic Claude, OpenAI ou xAI Grok, via AI SDK v7), trocável pelo Fábio na tela Agentes (D5) · **Hermes** (já rodando na VPS): na fase 1, os papéis de gestão rodam no **Kratos** (D6).

## Comandos (após o bootstrap de `app/`)

```bash
npm ci            # instalar
npm run dev       # http://localhost:3000
npm run lint      # ESLint
npm run typecheck # tsc --noEmit
npm test          # Vitest
npm run build     # produção
npm run check     # lint + typecheck + test + build (obrigatório antes de marcar [x])
```

Nenhum trabalho é "pronto" sem `npm run check` verde, verificação real (navegador, banco ou chamada de API) e evidência registrada no `PLAN.md`.

## Acessos (preflight fail-closed, antes de qualquer escrita)

- **GitHub:** org `Harmony-Digital`, repositório `hub-gestao` (privado). Usar a conta `fabioalmeidadigital` por processo: `GH_TOKEN="$(gh auth token --user fabioalmeidadigital)"`. A conta global do `gh` não é autorizada.
- **VPS:** `ssh vps-harmony` (KVM4 `1821299`, IPv4 `217.196.63.157`, hostname `vps-harmony-digital`, `srv1821299.hstgr.cloud`). Leitura é livre. Escrita só em `/opt/hub-gestao` e só quando o `PLAN.md` autorizar o passo.
- **Banco:** MCP `harmony-supabase` (variante `-readonly` para consultas). Resolver o schema pelo catálogo `harmony_admin.projects` (slug `hub-gestao` → `proj_hub_gestao`). Projeto novo só com `harmony_admin.create_project(...)`. Nunca tocar outros `proj_*`, nunca `supabase-relgov`, nunca `supabase-leonardo`.
- **DNS:** zona `harmonydigital.com.br` na Hostinger. Só o Fábio cria/altera registros, ou autoriza explicitamente o registro `hub` (CNAME → `srv1821299.hstgr.cloud`).
- **Segredos:** `/opt/hub-gestao/shared/.env.production` (VPS, `0600`) e `.env.local` (máquina local, fora do git). Nunca em chat, commit, log, comentário de tarefa ou documento.

## Nunca

- Marcar 🔒 GATE. Enviar mensagem a cliente. Publicar relatório sem aprovação.
- Alterar DNS, Traefik, Compose ou systemd sem ordem explícita do Fábio no `PLAN.md` ou no chat.
- `git add .`, `git add -A`, `git push --force`, commit de `.env*`.
- Duas sessões de IA simultâneas no mesmo repositório.
- Inventar fatos, prazos, valores ou status. Se não há evidência, a tarefa fica `[ ]`.
