# PRD — Hub de Gestão · Harmony Digital

> **Nota de 09/10/2026:** o produto chamado RELGOV neste documento passou a se chamar **Certato** (decisão dos sócios). As menções a RELGOV abaixo se referem ao mesmo sistema; repositório, VPS, contêineres e banco mantêm o nome técnico `relgov` até uma migração planejada.

**Projeto interno da Harmony Digital, de uso interno; arquitetura preparada para replicação futura (D7)** · Versão 1.1 · 2026-10-09
**Dono do produto:** Fábio Almeida (contato@harmonydigital.com.br)
**Status:** decisões D1–D11 tomadas pelo Fábio em 2026-10-09 (§19); aguarda o aceite do PRD (🔒 GATE M0 no `PLAN.md`)
**Progresso:** ver **`PLAN.md`** (checklist vivo por milestone, atualizado a cada sessão)
**Agentes:** ver **`AGENTES.md`** · **Instruções para IAs:** ver **`AGENTS.md`**

---

## 1. Visão geral

O **Hub de Gestão** é o sistema de gestão da Harmony Digital para **projetos, departamentos e atividades**, construído com uma premissa que as ferramentas de mercado não têm: **os agentes de IA são usuários de primeira classe**. Claude Code, Codex e um agente autônomo de gestão de projetos rodando no Hermes operam o sistema por API REST e MCP; pessoas (Fábio, equipe, clientes) acompanham, decidem e aprovam pela interface.

O produto organiza o trabalho em **três camadas** (estratégica, tática e operacional) e aplica uma regra simples de visibilidade: **o cliente vê a estratégia e, quando fizer sentido, a tática; nunca a operação**. Cada cliente ganha um **portal** para acompanhar a construção do seu projeto.

O Hub é a **fonte de verdade**. O `plan.md` que a Harmony cria em todo projeto continua existindo, mas passa a ser uma **projeção sincronizada** do Hub, com um código estável por tarefa. Os agentes continuam dando baixa no arquivo; o Hub absorve, consolida e devolve visão.

Endereço previsto: **`https://hub.harmonydigital.com.br`**. Repositório: **`Harmony-Digital/hub-gestao`** (privado). Hospedagem: VPS KVM4 da Harmony na Hostinger, com o Supabase self-hosted já existente.

Princípio que atravessa tudo: **"A IA executa. O humano decide."**

---

## 2. Problema e contexto

### 2.1 Como a Harmony trabalha hoje

- Todo projeto, sem exceção, nasce com `AGENTS.md`, `CLAUDE.md`, `PRD.md` e um **`PLAN.md` em formato checklist** por milestone, com itens **🔒 GATE** que só o Fábio aprova.
- Agentes de código (Claude Code, Codex) executam as tarefas e marcam `[x]` com evidência. Em projetos grandes o `PLAN.md` passa de 100 KB e muda várias vezes por dia (caso RELGOV).
- **Kratos**, agente pessoal do Fábio no **Hermes** (container na VPS, canal Telegram), cuida de comunicação, memória e crons.
- Infra própria: VPS KVM4 `vps-harmony-digital` (4 vCPU, 16 GB, 193 GB), Traefik via EasyPanel, n8n em modo fila, Evolution API, dois Supabase self-hosted (compartilhado e dedicado do RELGOV), pipeline GitHub Actions → VPS já provado.

### 2.2 Dores que o Hub resolve

| Dor | Consequência hoje | O que o Hub faz |
|---|---|---|
| O `plan.md` é técnico e operacional | Fábio não enxerga o macro; cliente não pode ver nada | Três camadas com rollup automático; marcos e frentes legíveis |
| Fábio não é planejador nem gestor | Planejamento tático fica a cargo do humor da sessão de IA | Agentes de gestão (Hermes) planejam, priorizam e cobram; Fábio só decide |
| Status para cliente é artesanal | Mensagens improvisadas no WhatsApp | Portal do cliente + relatório de status gerado de dados reais, com aprovação |
| Vários projetos, vários repositórios, zero visão de portfólio | Risco e atraso descobertos tarde | Painel de portfólio, saúde por regra, Vigia de Prazos |
| Departamentos sem fila própria | Marketing, design e dev se misturam no mesmo checklist | Departamentos transversais com visões por área e carga por agente/pessoa |
| Conhecimento de gestão preso em uma conversa | Cada sessão de IA recomeça | Hub guarda estado, histórico, decisões e evidências; agentes leem por MCP |

### 2.3 Referências visuais (declaradas pelo Fábio)

- **ClickUp** (referência principal): hierarquia Espaço → Pasta → Lista, múltiplas visões (lista, quadro, linha do tempo, calendário, tabela, painel), painel lateral de tarefa, status personalizáveis, densidade de informação, barra de comando.
- **Monday.com**: status em pílulas coloridas, tabelas editáveis, grupos.
- **Trello**: fluidez do quadro Kanban (arrastar e soltar, cartões leves).

A **identidade visual é a da Harmony** ("Sala de Controle": navy, off-white, laranja; Sora, DM Sans, JetBrains Mono). As referências orientam estrutura e experiência, não aparência.

### 2.4 Por que construir em vez de assinar o ClickUp

1. **Agentes como operadores nativos**: API e MCP desenhados para IA (fila, evidência, idempotência, aprovações), não adaptados depois.
2. **Regra de camadas e portal do cliente** no modelo de dados e no RLS, não em filtros manuais.
3. **Controle dos ativos** nas contas da Harmony (código, banco, domínio).
4. **Porta aberta para o futuro**: o uso é interno (D7), mas a arquitetura permite replicar o sistema se o Fábio decidir, depois de validado.
5. **Custo**: sem assento por agente; a infra já existe.

---

## 3. Objetivos, resultados esperados e não-objetivos

### 3.1 Objetivos

- **O1.** Dar ao Fábio uma visão macro confiável de todos os projetos, com decisões e aprovações concentradas em um só lugar ("Hoje").
- **O2.** Permitir que agentes (Hermes, Claude Code, Codex) planejem, executem e registrem trabalho no Hub sem intervenção manual, com auditoria completa.
- **O3.** Manter o fluxo atual de `plan.md` por projeto, agora sincronizado com o Hub nos dois sentidos.
- **O4.** Oferecer a cada cliente um portal com a camada estratégica (e tática quando marcada), relatórios aprovados e canal de comentários.
- **O5.** Organizar o trabalho por departamento, com fila e carga visíveis por área e por agente.
- **O6.** Nascer replicável por desenho: workspace, branding, departamentos, templates e agentes como configuração. Uso interno até o Fábio decidir outra coisa (D7); nenhum esforço comercial antes disso.

### 3.2 Resultados mensuráveis (ver §15)

Tempo do Fábio em gestão operacional próximo de zero; 100% das conclusões com evidência; status semanal do cliente com rascunho pronto sem esforço humano; zero vazamento de item operacional no portal (teste automatizado); agentes concluindo tarefas por MCP sem erro de autorização.

### 3.3 Não-objetivos (v1)

- Não é CRM, não é financeiro completo, não é chat corporativo, não é repositório de código.
- Não substitui o Git nem o `plan.md`: projeta e sincroniza.
- Não faz faturamento por hora (tempo registrado é informativo, fase 7).
- Não é marketplace de agentes nem orquestrador de LLM genérico: os agentes rodam no Hermes ou em sessões de código; o Hub é o estado compartilhado e a interface.
- Não expõe o cliente a nenhuma tela interna.

---

## 4. Usuários e papéis

### 4.1 Pessoas

| Papel | Quem | O que pode |
|---|---|---|
| `owner` | Fábio | Tudo. Único que decide gates por padrão, cria agentes e chaves, altera workspace. |
| `admin` | Sócios/gestores de confiança | Tudo, menos excluir workspace e gerir chaves de agente (configurável). |
| `member` | Equipe Harmony e parceiros | Projetos em que é membro: criar/editar tarefas e frentes, comentar, concluir. |
| `client_viewer` | Pessoa do cliente | Portal: ver marcos, frentes marcadas `client`, relatórios aprovados, comentar no canal do cliente. |
| `client_approver` | Decisor do cliente | `client_viewer` + confirmar recebimento de marco, quando o projeto ligar essa opção. O aceite é sempre do Fábio (D9). |
| `guest` | Convidado pontual | Leitura de um projeto específico. |

### 4.2 Agentes (detalhes em `AGENTES.md`)

| Tipo | Exemplos | Como entra |
|---|---|---|
| `hermes_autonomous` | Kratos, que na fase 1 acumula os papéis de Gestor de Projetos, Coordenador Tático, Relator, Guardião e Vigia (D6) | MCP/REST com chave própria; crons do Hermes |
| `coding_session` | Claude Code, Codex trabalhando em um repositório de projeto | MCP registrado no repo + CLI `hub` |
| `internal_llm` | Concierge, Planejador, Redator do Cliente, Onboarding | Rodam dentro do app (IA multi-provedor: Claude, OpenAI ou Grok, D5), com ator próprio |
| `integration` | GitHub, n8n, Telegram (via Hermes) | Webhooks com segredo; chave de agente com escopo mínimo |

Todo agente tem **departamento**, **camada de atuação**, **escopo de chave** e **orçamento de IA**.

---

## 5. Modelo de Gestão em Três Camadas

Esta seção responde ao pedido do Fábio: "a gente tem a gestão do projeto (macro) e a gestão tática/operacional (micro); eu não sou planejador; quero agentes que façam isso; o cliente vê a estratégia, talvez a tática, nunca a operação".

### 5.1 As camadas

| Camada | Objetos | Pergunta | Horizonte | Dono humano | Dono agente | Portal do cliente |
|---|---|---|---|---|---|---|
| **1. Estratégica (macro)** | Projeto (objetivo, fase, saúde), **Marcos** (entregas datadas com aceite), Riscos | O que entregamos, quando, e está saudável? | Semanas a meses | Fábio | Gestor de Projetos | **Sempre visível** (texto em `*_client`) |
| **2. Tática** | **Frentes** por departamento (pacotes de trabalho ligados a um marco), dependências entre frentes, capacidade | Como chegamos lá e quem cuida de cada parte? | Dias a semanas | Líder do departamento (quando houver) | Coordenador Tático | **Opcional por item** (`visibility = client`) mostrando título, descrição para cliente e progresso |
| **3. Operacional (micro)** | **Tarefas**, subtarefas, checklists, comentários internos, evidências, logs de agentes, tempo | O que está sendo feito agora e por quem? | Horas a dias | Equipe | Executores (código, design, marketing, dados) + Guardião | **Nunca**. Só o agregado (% da frente/marco) |

### 5.2 Regras de visibilidade (invariantes)

1. Operacional é sempre `internal`. Não existe tarefa `client`.
2. Marcos nascem `client`. Frentes nascem `internal` e podem ser promovidas a `client` por `owner/admin` ou pelo Redator do Cliente **com aprovação**.
3. Texto exibido ao cliente vem só de campos `title_client`, `description_client`, `summary_client`. Vazio = não exibe. Nunca cai no texto interno.
4. Comentários nascem `internal`. Canal do cliente é explícito (`visibility = client`) e passa por aprovação quando a autoria é de agente.
5. A regra é aplicada por **RLS** e por **`authorize()`** no servidor. Um teste automatizado (Playwright + SQL) garante que nenhum endpoint do portal retorna item operacional.

### 5.3 Rituais (quem faz o quê e quando)

| Ritual | Quando | Quem | Saída |
|---|---|---|---|
| **Digest matinal** | Dias úteis 8h | Coordenador Tático | Fila do dia por projeto/departamento, bloqueios, o que depende do Fábio. Telegram (Hermes) + inbox do Hub |
| **Revisão de prazos e riscos** | Diário, após rollup | Vigia (regra) + Gestor (explica) | Alertas de atraso, deriva de marco, dependência quebrada |
| **Status interno semanal** | Segunda | Relator | Rascunho por projeto; vira registro e alimenta o portfólio |
| **Status do cliente** | Sexta (configurável) | Relator → Redator do Cliente → **aprovação do Fábio** | Publicado no portal e, se habilitado, enviado por e-mail |
| **Aceite de marco** | Ao concluir frentes do marco | Gestor pede → Fábio decide → cliente acompanha no portal; confirmação de recebimento só se o projeto ligar (D9) | `milestones.status = accepted`, registro em `approvals` |
| **Replanejamento** | Quando saúde cai para vermelho ou escopo muda | Gestor propõe → Fábio aprova | Novo plano de marcos/frentes, histórico preservado |
| **Revisão de portfólio e departamentos** | Mensal | Gestor + Fábio | Carga por departamento e agente, projetos a pausar ou acelerar |

### 5.4 O cockpit do Fábio ("Hoje")

Fábio não recebe tarefas de planejamento; recebe **decisões**:
- **Aprovações pendentes** (relatório, aceite, replanejamento, promoção a `client`, criação de marco).
- **Bloqueios que dependem dele** (acesso, credencial, resposta de cliente, decisão de produto).
- **Riscos** com uma frase e uma ação sugerida.
- **Resumo dos agentes** (o que executaram nas últimas 24h).

Cada item tem três respostas: **Aprovar**, **Ajustar** (abre campo de orientação, o agente refaz) ou **Recusar**. Entrada por voz na barra de comando: o Concierge converte fala em ação estruturada e **mostra a prévia antes de executar**.

### 5.5 Mapeamento com o `plan.md`

```
# PLAN.md — <Projeto>                      → projects (code, name)
## M2 — Publicação inicial                 → milestones (title, order)      [camada 1]
### Pipeline                               → workstreams (title, dept.)    [camada 2]
- [x] Criar workflow de deploy (HUB-57)    → tasks (status done, code)     [camada 3]
  - [ ] Documentar rollback (HUB-58)       → tasks (parent = HUB-57)
### 🔒 GATE M2 (aprovação do Fábio)        → approvals (type milestone_acceptance)
- [ ] Health com SHA publicado             → critérios do gate (checklist do marco)
## Registro de Execução                     → activity_log / status_reports (somente leitura no arquivo)
```

Regras: o código `(HUB-n)` é o identificador estável; linhas sem código são tarefas novas e ganham código no `push`; o parser preserva byte a byte todo texto fora dos itens; `[x]` em linha de GATE vindo do arquivo é **ignorado** e gera alerta; o Hub vence conflitos e registra a divergência.

### 5.6 Estados

- **Projeto**: `in_review | discovery | active | paused | delivered | archived` (`in_review` = importado por agente, aguardando o ok do Fábio, D10); **fase Harmony**: `descobrir | validar | escalar`.
- **Marco**: `planned | in_progress | delivered | accepted | late` (`late` é derivado: data passou sem `delivered`).
- **Frente**: `planned | in_progress | blocked | done`.
- **Tarefa**: status **personalizáveis por projeto** (nome e cor, como no ClickUp) sobre **categorias fixas** `todo | in_progress | review | blocked | done`. O rollup usa a categoria, não o nome.

### 5.7 Saúde do projeto (regra em código)

- **Verde**: nenhum marco `late`, bloqueios < 10% das tarefas abertas, próximo marco com folga ≥ 0.
- **Amarelo**: um marco com deriva prevista (ritmo atual × trabalho restante > folga), ou bloqueios entre 10% e 25%, ou aprovação pendente > 3 dias úteis.
- **Vermelho**: marco `late`, ou bloqueios > 25%, ou dependência quebrada em marco corrente.

A IA nunca define a cor; só explica e sugere.

---

## 6. Conceitos e hierarquia

```
Workspace (Harmony Digital)
├── Departamentos (transversais): Estratégia · Marketing e Vendas · Agentes e Automações ·
│   Sistemas · Design · Dados · Gestão · Administrativo e Financeiro · Sucesso do Cliente
├── Agentes (com departamento, chave, escopo, orçamento)
├── Pessoas (memberships)
└── Clientes
    └── Projetos (código, fase, saúde, repo, plan.md)
        ├── Marcos ............................ camada 1
        │   └── Frentes (por departamento) .... camada 2
        │       └── Tarefas ................... camada 3
        │           ├── Subtarefas · Checklists · Comentários · Anexos · Evidência · Tempo
        ├── Aprovações (gates) · Relatórios de status · Riscos
        └── Portal do cliente (visão filtrada)
```

Projetos internos (ex.: o próprio Hub, o site da Harmony) pertencem a um cliente especial `Harmony Digital (interno)`.

---

## 7. Requisitos funcionais

Prioridade: **P0** (sem isso não há produto), **P1** (primeira versão completa), **P2** (evolução).

### 7.1 Workspace e identidade
- **RF-01 (P0)** Workspace com nome, slug, logo, cores, domínio, fuso (`America/Sao_Paulo`), idioma `pt-BR`.
- **RF-02 (P0)** Autenticação de pessoas via Supabase Auth: e-mail e senha, magic link; MFA opcional (P2). Primeiro usuário vira `owner`.
- **RF-03 (P1)** Convites por e-mail com papel e projetos.

### 7.2 Clientes
- **RF-04 (P0)** Cadastro de cliente: nome, slug, segmento, contatos, logo e cor de destaque (para o portal), notas internas.
- **RF-05 (P1, D9)** Acesso ao portal por contato (`client_viewer` / `client_approver`) só por convite: o contato nasce sem acesso e o `owner` libera quando quiser (e-mail pelo Hub ou link de uso único copiado por ele); magic link; revogável.

### 7.3 Projetos
- **RF-06 (P0)** Projeto com código curto (ex.: `RELGOV`), nome, cliente, departamentos envolvidos, fase (Descobrir/Validar/Escalar), status, datas, responsável humano, agente gestor, URL do repositório, caminho do `plan.md`, `require_evidence`, `client_can_confirm_receipt` (D9).
- **RF-07 (P0)** Painel do projeto em três blocos: **Macro** (marcos, saúde, próximos aceites), **Tático** (frentes por departamento com progresso), **Operacional** (fila do dia, bloqueios, atividade dos agentes).
- **RF-08 (P1)** Criação a partir de **template** (§7.15) ou a partir de um PRD/brief via Planejador (§AGENTES PL-11), sempre como rascunho para aprovação.

### 7.4 Marcos (camada estratégica)
- **RF-09 (P0)** Marco com título interno e para cliente, descrição para cliente, data alvo, ordem, `gate_required`, critérios de aceite (checklist), status derivado.
- **RF-10 (P0)** Aceite de marco só por humano autorizado; registra `approvals`; API/MCP recusam.
- **RF-11 (P1)** Histórico de datas (replanejamentos) visível internamente; o portal mostra a data vigente e a quantidade de revisões, nunca o motivo interno.

### 7.5 Frentes (camada tática)
- **RF-12 (P0)** Frente ligada a um marco e a um departamento; título, descrição interna e para cliente, visibilidade, ordem, status derivado, responsável (pessoa ou agente).
- **RF-13 (P1)** Dependências entre frentes; alerta quando a dependente começa antes da dependência terminar.

### 7.6 Tarefas (camada operacional)
- **RF-14 (P0)** Tarefa com código `HUB-n`, título, descrição Markdown, frente (opcional), tarefa-pai (subtarefas em um nível), status personalizável, prioridade (`urgent | high | normal | low`), responsável (pessoa **ou agente**), datas (início, entrega), estimativa, ordem, origem (`hub | plan_md | api | mcp | github`), referência externa, evidência de conclusão, motivo de bloqueio.
- **RF-15 (P0)** Status personalizáveis por projeto sobre categorias fixas, com cor; conjunto padrão Harmony: A fazer, Em andamento, Em revisão, Bloqueada, Concluída.
- **RF-16 (P0)** Conclusão exige evidência quando `require_evidence`; reabertura mantém histórico.
- **RF-17 (P0)** Comentários Markdown com menções (`@pessoa`, `@agente`), visibilidade (`internal` padrão), autor humano ou agente.
- **RF-18 (P1)** Checklist dentro da tarefa; anexos privados (Storage, URL assinada); etiquetas; dependências entre tarefas (`blocks`).
- **RF-19 (P2)** Campos personalizados por projeto (texto, número, seleção, data, URL); registro de tempo.

### 7.7 Visões
- **RF-20 (P0)** **Lista** (agrupável por status, frente, responsável, prioridade; ordenação; colunas configuráveis) e **Quadro** Kanban (arrastar e soltar entre status; swimlanes por frente ou responsável; fluidez tipo Trello).
- **RF-21 (P0)** **Painel lateral de tarefa** (side-peek) com tudo da tarefa sem sair da visão; atalhos de teclado.
- **RF-22 (P1)** **Linha do tempo** (marcos e frentes em barras, dependências), **Calendário** (entregas), **Tabela** (edição em linha, estilo Monday), **Painel** (widgets: saúde, progresso por marco, carga por departamento, atividade de agentes).
- **RF-23 (P1)** Filtros combináveis, visões salvas por usuário e por projeto, visão padrão por departamento.

### 7.8 Hoje (cockpit)
- **RF-24 (P0)** Tela "Hoje" por usuário: aprovações pendentes, bloqueios que dependem de mim, minhas tarefas, riscos, resumo de agentes (24h). Para `owner`, consolida todos os projetos.

### 7.9 Aprovações
- **RF-25 (P0)** Entidade `approvals` com tipo (`status_report`, `milestone_acceptance`, `replan`, `scope_change`, `client_visibility`, `external_message`, `agent_key`, `import_review`, `custom`), solicitante (humano ou agente), aprovador, prazo, decisão (`approved | rejected | adjust`) com orientação, e efeito automático ao aprovar (publicar, mudar status, promover visibilidade).
- **RF-26 (P0)** Nenhum efeito externo acontece sem `approved`. Agentes só `request`.

### 7.10 Departamentos
- **RF-27 (P0)** Departamentos do workspace com nome, slug, cor, líder (pessoa) e agentes vinculados.
- **RF-28 (P1)** Visão por departamento: quadro cruzando projetos, carga por agente/pessoa, bloqueios, tarefas sem responsável.

### 7.11 Agentes
- **RF-29 (P0)** Cadastro de agente: nome, tipo, departamento, descrição da missão, modelo/config (JSON), status (`active | paused | revoked`), orçamento mensal de IA, dono humano.
- **RF-29a (P0, D5)** **Modelo de IA por agente interno**: provedor (**Anthropic/Claude, OpenAI ou xAI/Grok**), modelo e credencial escolhidos na tela Agentes e trocáveis a qualquer momento pelo `owner`, sem deploy. A lista de modelos é buscada na API do provedor com a própria chave, com campo livre como alternativa. Botão "Testar conexão". Toda troca vai para `activity_log`.
- **RF-29b (P0, D5)** **Credenciais de IA**: cadastro de chaves de API por provedor, só pelo `owner`; chave cifrada no banco, exibida apenas com os 4 últimos caracteres, nunca enviada ao navegador, aos logs ou aos prompts; trocar a chave é colar a nova e salvar. Os papéis que rodam no Kratos trocam de modelo na configuração do próprio Hermes, não no Hub.
- **RF-30 (P0)** Chaves de agente: criação (valor exibido uma vez), escopos, projetos permitidos, expiração, último uso, revogação. Hash no banco.
- **RF-31 (P0)** **Console de agentes** ("Sala de Controle"): feed em tempo real de ações (de `activity_log`), filtros por agente/projeto, erros de autorização, custo de IA no mês, botão **pausar agente** (kill switch).

### 7.12 Notificações
- **RF-32 (P0)** Inbox no app (menções, atribuições, aprovações, bloqueios); preferências por tipo.
- **RF-33 (P1)** Canal externo: Telegram via Hermes (webhook de saída), e-mail via Resend (portal e resumos). Horário de silêncio 23h–8h para proativas.

### 7.13 Relatórios de status
- **RF-34 (P1)** Geração de rascunho (interno e para cliente) a partir de dados do período: marcos movidos, frentes concluídas, riscos, próximos passos. Cada rascunho é uma `approval`. Aprovado → publicado no portal (e enviado, se habilitado). Versões guardadas.

### 7.14 Portal do cliente (detalhe em §9)
- **RF-35 (P1)** Rota `/portal/<cliente>` com projetos do cliente, marcos, frentes `client`, progresso agregado, relatórios aprovados, canal de comentários, arquivos entregues, confirmação de recebimento de marco (se habilitado).

### 7.15 Templates de projeto
- **RF-36 (P1)** Template = esqueleto de marcos, frentes, tarefas, status, departamentos e textos para cliente. Iniciais da Harmony: *Site institucional*, *Agente de atendimento WhatsApp*, *Sistema sob medida com IA*, *Posicionamento de marca*, *Funil de aquisição*, *Monitoramento/inteligência*.
- **RF-37 (P2)** Exportar projeto como template; versionar templates.

### 7.16 Busca e comando
- **RF-38 (P0)** Barra de comando (`⌘K`) com busca global (projetos, tarefas por código ou título, pessoas, agentes) e ações rápidas.
- **RF-39 (P1)** Entrada em linguagem natural e **voz** (o Fábio dita): o Concierge interpreta, mostra a ação estruturada e só executa após confirmação.

### 7.17 Importação e sincronização
- **RF-40 (P0)** Importar um `PLAN.md` existente criando marcos, frentes e tarefas com códigos; relatório de importação. Importação feita por agente cria o projeto `in_review` e abre aprovação `import_review`, que o Fábio pode decidir em lote (D10).
- **RF-41 (P0)** CLI `hub plan pull | push` e endpoint de sincronização; GitHub Action opcional no push para `main`.
- **RF-42 (P1)** Webhook do GitHub: commit/PR com `HUB-n` na mensagem vira comentário e, com palavra-chave (`fecha HUB-n`), proposta de conclusão com o SHA como evidência (confirmação pelo Guardião ou humano).

### 7.18 Auditoria
- **RF-43 (P0)** `activity_log` append-only com ator, origem, antes/depois; linha do tempo por entidade; exportação por período (CSV/JSON).

---

## 8. Integração com agentes

### 8.1 Princípios

API-first (a UI consome a mesma camada de domínio), **mesma autorização** para humano e agente (`authorize()` + RLS), **idempotência** em escritas, **auditoria** de tudo, **documentação executável** (OpenAPI e lista de tools são testados em CI), **erros explicáveis** para que o agente corrija sozinho.

### 8.2 Chaves e escopos

Chave `hub_ak_<prefixo>.<segredo>`; só o hash fica no banco. Escopos:

| Escopo | Permite |
|---|---|
| `projects:read` · `milestones:read` · `tasks:read` · `agents:read` | Leitura no escopo de projetos da chave |
| `tasks:write` | Criar/editar tarefas e subtarefas (camada 3) |
| `tasks:complete` | Concluir com evidência; iniciar; bloquear |
| `workstreams:write` | Criar/editar frentes (camada 2) sem alterar visibilidade |
| `comments:write` | Comentar (`internal`) |
| `approvals:request` | Abrir pedidos de aprovação (marco, replan, texto para cliente, mensagem externa) |
| `reports:draft` | Criar rascunhos de status |
| `time:write` | Registrar tempo |
| `sync:plan` | Importar/exportar `plan.md` do projeto |
| `projects:import` | Cadastrar clientes e projetos e importar a árvore de um `plan.md`; o projeto nasce `in_review` e só fica ativo com o ok do Fábio (D10) |
| `workspace:*` | Administração (apenas chaves criadas pelo `owner` para o Gestor, se autorizado) |

Nunca disponível para agentes: `approvals:decide`, `portal:*`, `agents:keys`.

### 8.3 API REST v1

Base `https://hub.harmonydigital.com.br/api/v1` · `Authorization: Bearer <chave>` · JSON · cursor pagination (`?cursor=&limit=`) · `Idempotency-Key` obrigatório em POST/PUT/PATCH · erros `application/problem+json` · `ETag`/`If-Match` em PATCH de tarefa · rate limit por chave (padrão 600 req/min) · OpenAPI 3.1 em `/api/v1/openapi.json`.

| Recurso | Métodos principais |
|---|---|
| `/me` | `GET` identidade da chave, escopos, projetos |
| `/projects` · `/projects/{code}` · `/projects/{code}/plan` | `GET` (árvore marcos→frentes→tarefas) · `GET /health` |
| `/projects/{code}/milestones` · `/milestones/{id}` | `GET`; `POST` só via `approvals` |
| `/projects/{code}/workstreams` · `/workstreams/{id}` | `GET` `POST` `PATCH` |
| `/tasks` · `/tasks/{code}` | `GET` (filtros: `project`, `assignee=me`, `status_category`, `due_before`, `blocked`) · `POST` · `PATCH` |
| `/tasks/{code}/start` · `/complete` · `/block` · `/reopen` | `POST` (complete exige `evidence`) |
| `/tasks/{code}/comments` | `GET` `POST` |
| `/tasks/{code}/time` | `POST` |
| `/approvals` · `/approvals/{id}` | `GET` · `POST` (request) · `POST /decide` (humanos, sessão web apenas) |
| `/reports` | `POST` rascunho · `GET` |
| `/today` | `GET` fila consolidada para o ator (tarefas, bloqueios, aprovações) |
| `/search?q=` | `GET` |
| `/sync/plan` | `POST` (import/push) · `GET` (export/pull) |
| `/events` | `GET` SSE (opcional, P2) |

### 8.4 Servidor MCP

Endpoint `https://hub.harmonydigital.com.br/mcp` (Streamable HTTP, sem estado, `@modelcontextprotocol/sdk`), mesma chave Bearer. Nomes em inglês, descrições em PT-BR curtas e distintas (lição do n8n: tools parecidas confundem o agente).

| Tool | O que faz | Escopo |
|---|---|---|
| `hub_whoami` | Identidade, workspace, projetos, escopos, orçamento restante | — |
| `hub_list_projects` / `hub_get_project` | Projetos do escopo; detalhe com saúde e próximos marcos | `projects:read` |
| `hub_get_plan` | Árvore completa (marcos → frentes → tarefas) ou Markdown no formato `plan.md` | `projects:read` |
| `hub_get_today` | Fila do ator: tarefas, bloqueios, aprovações pendentes relevantes | leitura |
| `hub_list_tasks` / `hub_get_task` | Busca filtrada; detalhe com comentários e evidências | `tasks:read` |
| `hub_create_task` | Nova tarefa operacional (frente/pai opcional) | `tasks:write` |
| `hub_update_task` | Título, descrição, prioridade, datas, responsável, status (não `done`) | `tasks:write` |
| `hub_start_task` / `hub_block_task` / `hub_complete_task` | Transições; `complete` exige `evidence` | `tasks:complete` |
| `hub_comment` | Comentário interno em tarefa, frente, marco ou projeto | `comments:write` |
| `hub_create_workstream` / `hub_update_workstream` | Frentes (camada 2) | `workstreams:write` |
| `hub_request_approval` | Pedido: aceite de marco, replan, novo marco, promoção a `client`, mensagem externa | `approvals:request` |
| `hub_list_approvals` | Pedidos do ator e status | leitura |
| `hub_draft_status_report` | Rascunho de status (interno ou cliente) para um período | `reports:draft` |
| `hub_log_time` | Tempo em tarefa | `time:write` |
| `hub_search` | Busca global no escopo | leitura |
| `hub_sync_plan` | Importar ou exportar `plan.md` | `sync:plan` |
| `hub_create_client` | Cadastra cliente (nome, segmento, contatos internos; sem acesso ao portal) | `projects:import` |
| `hub_create_project` | Cadastra projeto `in_review` ligado a um cliente, com departamentos, repositório e caminho do `plan.md` | `projects:import` |
| `hub_import_plan` | Importa um `plan.md` inteiro para um projeto `in_review` (marcos, frentes, tarefas, GATEs) e abre aprovação `import_review` | `projects:import` |

Resources: `hub://projects/{code}/plan.md`, `hub://projects/{code}/health`, `hub://today`. Prompts: `status-semanal`, `digest-matinal`, `revisar-conclusoes`.

### 8.5 CLI `hub` e sincronização do `plan.md`

- Pacote `@harmony/hub-cli` (Node, binário `hub`), configurado por `.hub.json` no repositório do projeto (`project_code`, `plan_path`) e `HUB_API_KEY` no ambiente.
- `hub plan pull`: baixa a árvore e **regrava apenas as linhas de item**, preservando o resto do arquivo; adiciona `(HUB-n)` onde faltar.
- `hub plan push`: envia o diff de estados (`[ ]`↔`[x]`, novos itens, itens removidos marcados como `archived`, nunca apagados); linhas de GATE marcadas são ignoradas e alertadas.
- `hub task done HUB-n --evidence "sha|url"` · `hub task start HUB-n` · `hub task new "título" --under HUB-n`.
- GitHub Action `hub-sync.yml` (opcional por repo): `push` em `main` → `hub plan push`.
- Conflito: o Hub vence; a divergência vira comentário na tarefa e entrada em `plan_sync_runs`.

### 8.6 Webhooks de saída

Eventos: `task.created|updated|completed|blocked`, `workstream.updated`, `milestone.status_changed`, `approval.requested|decided`, `report.published`, `project.health_changed`, `agent.budget_exceeded`. Assinatura HMAC-SHA256, retentativas exponenciais, painel de entregas. Primeiros assinantes: Hermes (Telegram do Fábio) e n8n.

### 8.7 Integrações de entrada

- **GitHub**: webhook de `push` e `pull_request`; menção `HUB-n` vira comentário com link; `fecha HUB-n` vira proposta de conclusão com SHA (confirmada pelo Guardião ou humano).
- **Hermes**: agentes autônomos via MCP; crons do próprio Hermes disparam os rituais.
- **n8n**: fluxos que já existem na VPS podem criar tarefas (ex.: lead qualificado → tarefa em Marketing e Vendas).
- **Telegram/WhatsApp**: sempre via Hermes/n8n; o Hub não fala com canais diretamente na v1.

### 8.8 Limites

Rate limit por chave; payload máximo 1 MB; anexos até 25 MB; orçamento de IA por agente interno; agentes pausados recebem `423 Locked`.

---

## 9. Portal do cliente

- **Acesso (D9)**: `https://hub.harmonydigital.com.br/portal/<cliente>`; um endereço mais amigável só para o cliente pode ser somado depois (D1). **Só entra quem o Fábio cadastrar, e só quando ele liberar**: o contato nasce sem acesso; o botão "Liberar acesso", exclusivo do `owner`, envia o convite por e-mail ou gera um link de uso único para o Fábio enviar por onde quiser. Sem cadastro aberto. Login por magic link; sessão curta; sem senha; acesso revogável a qualquer momento.
- **Vê**: nome e logo da Harmony + cor do cliente; lista de projetos do cliente; por projeto: objetivo (texto para cliente), fase (Descobrir/Validar/Escalar), **marcos** com data e status, **frentes marcadas `client`** com progresso agregado, **relatórios aprovados** (histórico), **canal de comentários** (`visibility = client`), **arquivos entregues**. O aceite de marco é do Fábio (D9); o botão **Confirmar recebimento** existe como opção por projeto, desligada por padrão.
- **Nunca vê**: tarefas, subtarefas, comentários internos, evidências, nomes de agentes, logs, custos, prazos internos de frentes `internal`, motivos de replanejamento, outros clientes.
- **Garantias**: RLS por `project_members` com papel `client_*`; endpoints do portal servem apenas DTOs sem campos internos; teste automatizado de vazamento em CI; `noindex`; sem rastreadores de terceiros.
- **Tom**: segunda pessoa, linguagem de resultado, sem jargão interno, sem nomes de ferramentas, sem valores. Textos propostos pelo Redator do Cliente e aprovados pelo Fábio.
- **LGPD**: contatos consentem no primeiro acesso; exportação e exclusão de dados do cliente sob pedido (§12).

---

## 10. Arquitetura técnica e stack

### 10.1 Stack

| Camada | Escolha | Por quê | Alternativa considerada |
|---|---|---|---|
| Framework web + API | **Next.js 16 (App Router, Node runtime, `output: standalone`)** + TypeScript | Mesmo padrão e pipeline do RELGOV na VPS; Route Handlers para REST/MCP; SSR para o portal | TanStack Start (padrão de apps novos da Harmony; fica como opção D3) |
| UI | **Tailwind v4 + shadcn/ui (Radix) + lucide-react** | Padrão da casa; acessibilidade; tokens Harmony | Mantine |
| Estado e dados no cliente | **TanStack Query** (servidor) + **Zustand** (UI) + **TanStack Table** | Padrão da casa; tabelas densas | Redux |
| Arrastar e soltar | **@dnd-kit** | Quadro e reordenação com acessibilidade | react-beautiful-dnd (descontinuado) |
| Formulários e validação | **react-hook-form + zod** | zod reaproveitado na API e MCP | — |
| Editor de texto | **TipTap** (Markdown in/out) | Comentários e descrições | Textarea Markdown puro (fallback) |
| Linha do tempo / calendário | Componentes próprios sobre CSS Grid + `date-fns` (+ `@tanstack/react-virtual`) | Controle visual Harmony; sem dependência pesada | gantt-task-react |
| Gráficos | **Recharts** com tokens Harmony | Painéis | — |
| Barra de comando | **cmdk** | ⌘K, busca e ações | — |
| Banco, Auth, Storage, Realtime | **Supabase self-hosted compartilhado** (`supabase.harmonydigital.com.br`), PostgreSQL 17, schema **`proj_hub_gestao`** | Já existe na VPS; convenção `harmony_admin.projects` + `proj_<slug>`; RLS; Realtime para quadro ao vivo | Instância dedicada (como RELGOV) quando o produto for vendido (D2) |
| Acesso ao banco | `@supabase/supabase-js` (sessão + RLS) e `postgres.js`/Kysely para consultas tipadas server-side | Simplicidade + consultas complexas de rollup | Prisma/Drizzle |
| Autorização | `authorize(actor, action, resource)` central + RLS | Mesma regra para humano e agente | Casbin |
| API para agentes | Route Handlers `/api/v1` + `zod-openapi` (OpenAPI 3.1) | Contrato gerado do código, testado em CI | tRPC (não serve a agentes externos) |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP em `/mcp` | Claude Code, Codex e Hermes falam MCP nativamente | Serviço separado (fica como opção se o Next.js limitar) |
| Jobs e agenda | Tabela `jobs` no Postgres (`FOR UPDATE SKIP LOCKED`) + `systemd timer` → `/api/internal/cron/*` | Sem Redis; padrão já usado no RELGOV | n8n (continua disponível para integrações), pg_cron |
| LLM (agentes internos) | **Multi-provedor por agente (D5)**: **AI SDK v7** (`ai`, o mesmo já usado no sistema de reservas) com `@ai-sdk/anthropic`, `@ai-sdk/openai` e `@ai-sdk/xai`. Provedor, modelo e credencial vêm da configuração de cada agente, na tela Agentes. Sugestão inicial: Claude `claude-sonnet-5-5` para redação e planejamento, `claude-haiku-5-5` para classificação. Cache de prompt quando o provedor suportar; orçamento por agente | O Fábio troca entre Claude, OpenAI e Grok mudando só chave e modelo; uma interface única para os três; fail-closed sem LLM | Adaptador próprio por provedor, como no IA Posicionamento (mais código para manter) |
| Agentes autônomos | **Hermes** (já na VPS): na fase 1, os papéis de gestão rodam como skills do **Kratos** (D6); um agente dedicado pode vir depois sem mudança no Hub, só com outra chave; crons do Hermes | Já roda, já fala Telegram, já é o agente do Fábio, suporta MCP e crons | n8n AI Agent (fica para integrações simples) |
| Voz | Web Speech API no navegador para ditado + `gpt-4o-transcribe` ou equivalente no servidor (opcional) | Fábio dita por voz | — |
| E-mail | **Resend** | Padrão da casa | — |
| Observabilidade | `pino` + `/api/health` (SHA) + `activity_log`; Sentry opcional (P2) | Suficiente para a fase; sem custo | — |
| Testes | Vitest, Testing Library, Playwright, SQL de RLS, contratos OpenAPI/MCP | Padrão da casa | — |
| CI/CD | GitHub Actions: `ci.yml` + `deploy-vps.yml` (SSH restrito `load <sha>`, rollback por healthcheck) | Padrão RELGOV provado | Vercel (descartada: o Hub roda na VPS) |
| Runtime | Node 22 LTS, npm (Bun opcional para dev) | Compatível com o pipeline existente | — |

### 10.2 Visão de componentes

```
 Pessoas ──HTTPS──┐                                  ┌── Hermes (VPS): Gestor, Coordenador, Relator, Guardião, Vigia, Kratos
 Portal do cliente┤                                  ├── Claude Code / Codex (repos dos projetos) + CLI hub
                  ▼                                  ├── GitHub (webhooks) · n8n (fluxos)
         Traefik (EasyPanel) ── hub.harmonydigital.com.br
                  │
         ┌────────┴──────────── hub-app (Docker, Next.js 16) ─────────────┐
         │  UI (App Router)  │  /api/v1 REST  │  /mcp  │  /api/internal   │
         │        └──────── domínio (modules) + authorize() + audit ──────┘
         │  llm adapter (Claude/OpenAI, orçamento)   jobs (Postgres queue)
         └───────────────────────────┬───────────────────────────────────┘
                                     ▼
        Supabase self-hosted compartilhado (Kong → PostgREST/Auth/Storage/Realtime → PostgreSQL 17)
                      schema proj_hub_gestao · RLS · activity_log · harmony_admin.projects
```

### 10.3 Decisões de arquitetura (ADRs resumidos)

1. **API-first e domínio único**: UI, REST e MCP usam os mesmos casos de uso em `src/modules/*`. Evita divergência entre o que o humano e o agente podem fazer.
2. **Agentes autenticados por chave própria**, nunca por usuário humano emprestado. Ator sempre identificado.
3. **Rollups em SQL/TS**, nunca em LLM. Views `v_workstream_progress`, `v_milestone_progress`, `v_project_health` recomputadas por trigger leve ou job.
4. **Hub como fonte de verdade; `plan.md` como projeção**. O parser é byte-neutro fora dos itens.
5. **Supabase compartilhado primeiro** (velocidade, zero custo); migração para instância dedicada por workspace quando houver venda (script de export/import de schema previsto).
6. **MCP dentro do app** para reduzir peças; separar só se houver limitação de runtime.
7. **Sem Redis na v1**: fila no Postgres; Realtime do Supabase para UI ao vivo.
8. **Sem Vercel**: tudo na VPS, com o mesmo isolamento do RELGOV (rede própria, sem root, rootfs somente leitura).

---

## 11. Modelo de dados (essência)

Schema `proj_hub_gestao`. Todas as tabelas com `id uuid`, `workspace_id`, `created_at`, `updated_at`, RLS habilitada. Enums Postgres para estados fechados.

**Identidade e organização**
- `workspaces` (slug, name, branding jsonb, timezone, locale, settings jsonb)
- `profiles` (id = auth.users.id, email, full_name, avatar_url, deactivated_at)
- `memberships` (workspace_id, user_id, role, status)
- `clients` (slug, name, segment, accent_color, logo_path, notes_internal, portal_enabled)
- `client_contacts` (client_id, user_id, role `client_viewer|client_approver`, access_status `none|invited|active|revoked`, invited_at, invited_by_user_id, consent_at) — o contato nasce `none`; só o `owner` libera (D9)
- `departments` (slug, name, color, lead_user_id, sort_order)

**Agentes**
- `agents` (name, kind, department_id, mission, config jsonb, llm_provider `anthropic|openai|xai`, llm_model, llm_credential_id, status, budget_usd_month, spent_usd_month, owner_user_id)
- `agent_api_keys` (agent_id, key_prefix, key_hash, scopes text[], project_ids uuid[], expires_at, last_used_at, revoked_at)
- `agent_runs` (agent_id, started_at, finished_at, source, summary, cost_usd, error) — para o console
- `llm_credentials` (provider, label, key_ciphertext, key_last4, created_by_user_id, rotated_at, revoked_at) — chave de API cifrada com AES-256-GCM e `HUB_ENCRYPTION_KEY`; só o servidor decifra, no momento da chamada (D5)

**Trabalho**
- `projects` (client_id, code, name, objective_internal, objective_client, phase, status, start_date, target_date, owner_user_id, pm_agent_id, repo_url, plan_path, require_evidence, client_can_confirm_receipt, health, health_reason jsonb, archived_at)
- `project_departments` (project_id, department_id)
- `project_members` (project_id, user_id, role `lead|member|client_viewer|client_approver|guest`)
- `project_agents` (project_id, agent_id, role)
- `milestones` (project_id, title, title_client, description_client, due_date, sort_order, gate_required, status, delivered_at, accepted_at, accepted_by_user_id, acceptance_criteria jsonb, visibility default `client`)
- `milestone_date_history` (milestone_id, old_due, new_due, reason_internal, approval_id)
- `workstreams` (project_id, milestone_id, department_id, title, title_client, description_internal, description_client, visibility, status, sort_order, assignee_type, assignee_id)
- `workstream_dependencies` (workstream_id, depends_on_id)
- `task_statuses` (project_id, name, color, category, sort_order, is_default)
- `tasks` (project_id, workstream_id, parent_task_id, code `HUB-n` via `workspace_task_sequence`, title, description_md, status_id, priority, assignee_type, assignee_id, start_date, due_date, estimate_minutes, sort_key, source, external_ref, done_evidence, completed_at, completed_by_type, completed_by_id, blocked_reason, archived_at)
- `task_dependencies` (task_id, blocks_task_id)
- `task_labels` · `labels`
- `checklist_items` (task_id, text, done, sort_order)
- `comments` (entity_type, entity_id, body_md, visibility, author_type, author_id, mentions jsonb, edited_at)
- `attachments` (entity_type, entity_id, storage_path, filename, mime, size, visibility, uploaded_by_type, uploaded_by_id)
- `time_entries` (task_id, actor_type, actor_id, minutes, date, note)
- `custom_fields` · `custom_field_values` (P2)

**Governança e comunicação**
- `approvals` (type, entity_type, entity_id, requested_by_type, requested_by_id, approver_user_id, due_at, status, decision_note, decided_at, payload jsonb, effect jsonb)
- `status_reports` (project_id, period_start, period_end, audience, body_md, generated_by_agent_id, approval_id, published_at, version)
- `notifications` (user_id, type, entity_type, entity_id, read_at, payload jsonb) · `notification_prefs`
- `webhooks` (url, events text[], secret_hash, active) · `webhook_deliveries`
- `activity_log` (actor_type, actor_id, acting_role, source, action, entity_type, entity_id, before jsonb, after jsonb, request_id) — append-only, sem políticas de UPDATE/DELETE para a aplicação
- `idempotency_keys` (key, actor_id, request_hash, response jsonb, expires_at)
- `jobs` (type, payload, run_at, locked_at, attempts, last_error)
- `plan_sync_runs` (project_id, direction, source, commit_sha, summary jsonb, conflicts jsonb)
- `saved_views` (user_id, project_id, department_id, type, config jsonb)
- `project_templates` (name, description, structure jsonb, version)

**Derivados (views/functions)**: `v_workstream_progress`, `v_milestone_progress`, `v_project_health`, `v_department_load`, `fn_next_task_code(workspace_id)`, `fn_rollup_project(project_id)`.

**RLS (estratégia)**: `has_workspace_access()`, `has_project_access(project_id, min_role)`, `is_client_of_project(project_id)`; políticas de leitura para cliente exigem `visibility = 'client'` e tabela permitida (marcos, frentes, relatórios publicados, comentários `client`, anexos `client`). Testes SQL com dois workspaces e um cliente.

---

## 12. Segurança, privacidade e LGPD

- `service_role` só no servidor; navegador usa sessão + RLS. Chaves de agente em hash com pepper; valor em claro exibido uma vez.
- Chaves de API de IA (Anthropic, OpenAI, xAI) cifradas em `llm_credentials` com `HUB_ENCRYPTION_KEY`, que só existe no `.env.production`; decifradas só no servidor, no momento da chamada; nunca devolvidas à interface, nunca em logs, prompts ou `activity_log`, que registra apenas "credencial trocada" com os 4 últimos caracteres (D5).
- `authorize()` central antes de qualquer mutação; RLS como segunda linha; testes de autorização para cada tool MCP e rota.
- Idempotência, rate limit por chave, tamanho máximo de payload, CORS fechado, cabeçalhos de segurança (CSP, HSTS, noindex no portal), cookies `HttpOnly/Secure/SameSite`.
- Segredos só em `.env.production` (VPS, `0600`) e `.env.local`; nunca em git, logs, prompts ou comentários. Rotação documentada.
- Prompts de LLM recebem o mínimo de dados; nenhum segredo ou dado pessoal desnecessário; respostas de LLM nunca executam ações sem passar por `authorize()` e, quando externas, por `approvals`.
- Dados de clientes: base legal de execução de contrato; consentimento registrado no primeiro acesso ao portal; exportação (JSON/CSV) e exclusão por cliente sob pedido; retenção de logs 12 meses (configurável).
- Auditoria completa em `activity_log`; console de agentes com kill switch; orçamento de IA por agente.
- Isolamento do container como no RELGOV: sem root, rootfs somente leitura, sem `docker.sock`, rede própria `hub_proxy`, limites de CPU/RAM.

---

## 13. Infraestrutura, deploy e operação

### 13.1 Onde roda

VPS Hostinger **KVM 4** `1821299` (`vps-harmony-digital.harmonydigital.com.br`, `217.196.63.157`, `srv1821299.hstgr.cloud`), Ubuntu 24.04, 4 vCPU, 16 GB RAM (≈9 GB disponíveis em 08/10/2026), 193 GB de disco (163 GB livres). Já roda: Traefik 3 (EasyPanel), n8n em modo fila + Postgres + Redis (`automation_stack`), Evolution API, Hermes (`hermes_agent`), Supabase compartilhado (`/opt/supabase-harmony`, PostgreSQL 17.6), Supabase dedicado do RELGOV, apps `relgov-app` e `carla-mileia-api`. O Hub adiciona **um** container (`hub-app`, ~200–400 MB) e um schema no Supabase compartilhado. Capacidade é suficiente; medir antes de cada novo serviço.

### 13.2 Domínio e DNS

Registro **`hub`** (D1) do tipo **CNAME → `srv1821299.hstgr.cloud`** na zona `harmonydigital.com.br` (Hostinger, hPanel). Nunca trocar nameservers (a zona hospeda MX/SPF do Microsoft 365, `posicionamento`, `relgov`, `reservas`, `monclair`, etc.). Traefik emite e renova o certificado Let's Encrypt. Criação do registro: Fábio, ou autorização explícita no `PLAN.md`.

### 13.3 Pipeline (padrão RELGOV, nomes `hub-*`)

1. Push em `main` de `Harmony-Digital/hub-gestao` → `ci.yml`: `npm ci`, lint, typecheck, testes, build.
2. `deploy-vps.yml` (ambiente `hub-production`): constrói imagem **sem segredos**, envia por SSH restrito (`load <sha>`) ao usuário de deploy da VPS, que valida o SHA e troca o container; healthcheck em `/api/health`; rollback automático.
3. Segredos do GitHub: `HUB_VPS_HOST`, `HUB_VPS_USER`, `HUB_VPS_SSH_KEY`, `HUB_VPS_KNOWN_HOSTS`, `HUB_NEXT_PUBLIC_SUPABASE_ANON_KEY`; variável `HUB_DEPLOY_URL`. Provisionados pelo Fábio.
4. Na VPS (root): `/opt/hub-gestao/{config/docker-compose.yml, shared/.env.production, releases/}`; rota Traefik `/etc/easypanel/traefik/config/hub.yaml`; `hub-cron.timer` (systemd) chamando `/api/internal/cron/tick` a cada 5 min com `CRON_SECRET`.
5. Staging: `HUB_STAGE=staging` com `noindex` e banner, mesmo container, quando necessário (D11 publica cedo atrás de login).

### 13.4 Banco

Schema `proj_hub_gestao` registrado via `harmony_admin.create_project('hub_gestao', 'Hub de Gestão', 'Harmony Digital')` (o catálogo aceita só minúsculas, números e sublinhado); migrations `hub_gestao_NNNN_*.sql` aplicadas pelo MCP `harmony-supabase` (`apply_migration`); schema exposto no PostgREST (`PGRST_DB_SCHEMAS`) se a UI usar `supabase-js` direto (alternativa: só server-side); advisors após cada migration. Acesso do agente de deploy: nenhum. Acesso do app: `service_role` em `.env.production` (pendência conhecida: role restrita ao schema, herdada do RELGOV).

### 13.5 Backups e recuperação (D8)

Decidido (D8, 2026-10-09): `pg_dump -n proj_hub_gestao` diário (systemd timer) com cópia fora da VPS, ativo desde o M2, antes de qualquer dado real; snapshot semanal da VPS na Hostinger; teste de restauração mensal.

### 13.6 Observabilidade e operação

`/api/health` (versão = SHA, banco ok, fila ok), logs `pino` em stdout (`docker logs`), `agent_runs` e `activity_log` como telemetria funcional, alertas por webhook (Hermes → Telegram) para: deploy falhou, fila parada, orçamento de IA estourado, erro de autorização recorrente. Runbook em `docs/operacao.md`.

### 13.7 Custos

Infra marginal zero (VPS e Supabase já pagos). IA: orçamento inicial US$ 30/mês somado para os agentes internos (D5), com teto por agente editável na tela Agentes; o custo real depende do provedor e do modelo que o Fábio escolher em cada agente. Os papéis que rodam no Kratos usam o modelo e a conta já configurados no Hermes. Resend no plano atual. Domínio já existente.

---

## 14. Identidade visual e design system

### 14.1 Tokens (de `Site 2026/styles.css` e do brief da marca)

```css
:root {
  --navy: #151A2D; --navy-2: #1B2139; --navy-3: #10141F; --navy-4: #232A45;
  --off: #FAF8F4; --off-2: #F3F0EA; --card: #FFFEFB;
  --orange: #F28C1D; --orange-2: #FFA94D; --orange-dark: #9E5306;
  --ink: #2B3040; --ink-2: #4A5061; --mist: #C9CCD6; --mist-2: #8E93A3;
  --line: #E7E2D9; --line-d: rgba(250,248,244,.09);
  /* semânticas (novas, para status e saúde) */
  --ok: #2F8F5B; --warn: #D98B1E; --danger: #C8463C; --info: #3B6FB6; --neutral: #8E93A3;
  --font-display: 'Sora'; --font-body: 'DM Sans'; --font-mono: 'JetBrains Mono';
  --radius: 10px; --radius-lg: 16px;
}
```

- **Tema claro (padrão, D4)**: fundo `--off`, superfícies `--card`, texto `--ink`, bordas `--line`, ação primária `--orange` com texto `--navy`. Pensado para horas de trabalho.
- **Tema escuro "Sala de Controle"**: fundo `--navy`, superfícies `--navy-2/4`, texto `--off`, bordas `--line-d`. Console de agentes usa este tema por padrão, com linhas `agente / sistema / humano` em mono.
- Cores de status de tarefa são personalizáveis por projeto a partir de uma paleta derivada (ok, warn, danger, info, neutral, orange, mist) para manter coerência.

### 14.2 Tipografia e densidade

Sora 600/700 para títulos e nomes de projeto; DM Sans 400/500 para texto e tabelas; JetBrains Mono para códigos `HUB-n`, SHAs, console e metadados. Escala compacta (13–14 px em tabelas, 15–16 px em leitura), espaçamento de 4 px, linhas de 36–40 px em listas. Densidade próxima do ClickUp, respiro maior nas telas de decisão (Hoje, aprovações) e no portal.

### 14.3 Componentes e padrões

- Shell: barra lateral recolhível (Hoje · Minhas tarefas · Aprovações · Clientes › Projetos · Departamentos · Agentes · Relatórios · Configurações), barra superior com `⌘K`, criação rápida, avatar; breadcrumb; abas de visão por projeto.
- Pílulas de status e prioridade (Monday), cartões leves no quadro (Trello), painel lateral de tarefa (ClickUp), linha do tempo com barras finas e marcos em losango, console em mono.
- Ícones `lucide-react`, 16–18 px. **Sem emojis.** Sem ilustrações genéricas.
- Movimento: 150–220 ms, `transform/opacity`, `prefers-reduced-motion` respeitado. Arrastar e soltar com ghost sutil e drop target em laranja a 20%.
- Acessibilidade: contraste AA, foco visível (anel laranja), navegação por teclado completa nas visões, `aria-live` para mudanças de status.
- Portal do cliente: mesma base, mais ar, logo da Harmony, cor de destaque do cliente só em detalhes; linguagem em segunda pessoa.

---

## 15. Métricas de sucesso

| Métrica | Alvo (90 dias após M6) |
|---|---|
| Tempo semanal do Fábio em gestão operacional (planejar, cobrar, montar status) | < 1 h, concentrado em decisões no "Hoje" |
| Conclusões de tarefa com evidência | 100% nos projetos `require_evidence` |
| Status semanal do cliente com rascunho pronto antes da sexta 12h | ≥ 90% dos projetos ativos |
| Vazamento de item operacional no portal | 0 (teste automatizado em CI) |
| Chamadas de agentes por MCP/REST com erro de autorização por desenho | < 1% |
| Projetos ativos da Harmony dentro do Hub | 100% |
| Tempo de deploy push → produção saudável | < 10 min |
| Latência p95 das visões lista/quadro | < 400 ms |

---

## 16. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Escopo grande para um sistema "tipo ClickUp" | Nunca sair do papel | P0 enxuto (API, MCP, lista/quadro, Hoje, aprovações); visões avançadas em M7; publicar cedo (D11) |
| Agentes marcando tarefas sem evidência | Progresso falso | `require_evidence`, Guardião reabre, rollup só conta `done` com evidência |
| Vazamento de conteúdo interno ao cliente | Quebra de confiança | Campos `*_client` separados, RLS, DTOs do portal, teste de vazamento em CI, aprovação para promover visibilidade |
| Duas fontes de verdade (`plan.md` × Hub) | Confusão e retrabalho | Hub vence; parser byte-neutro; conflitos virando comentários; códigos estáveis |
| Supabase compartilhado com outros projetos | Acoplamento, incidente lateral | Regras do `harmony_admin`; schema próprio; plano de migração para dedicado |
| Custo de IA fora de controle | Despesa inesperada | Orçamento por agente, teto global, resposta determinística ao estourar |
| Hermes mudar formato de configuração/MCP | Agentes autônomos param | Agentes também falam REST; skill de fallback; versão fixada no `agents/hermes/README` |
| Deploy derrubar o container enquanto um agente escreve | Escrita perdida | Idempotência + retentativa no cliente; deploy fora do horário de pico; healthcheck |
| Fábio sobrecarregado de aprovações | Gargalo humano | Agrupar aprovações, prazos, padrões aprovados virarem regra (ex.: frentes de um template já nascem `client`) |
| Backups indefinidos na VPS | Perda de dados | D8 decidido em M8, antes de clientes no portal |

---

## 17. Roadmap (resumo; checklist completo em `PLAN.md`)

| Milestone | Entrega | Gate |
|---|---|---|
| **M0** Fundação e decisões | Repo, bootstrap, tokens, schema registrado, decisões D1–D11 respondidas | Fábio aprova PRD e decisões |
| **M1** Núcleo para agentes | Modelo de dados + RLS, `authorize()`, REST v1, MCP, chaves, auditoria, idempotência | Agente de teste cria e conclui tarefa por MCP |
| **M2** Publicação inicial | Pipeline VPS, domínio `hub`, health, login; atrás de autenticação | `https://hub.harmonydigital.com.br/api/health` com SHA |
| **M3** Interface essencial | Shell, Hoje, projetos, lista, quadro, painel de tarefa, aprovações, console de agentes | Fábio opera um projeto real pela UI |
| **M4** `plan.md`, CLI e GitHub | Import/export, `hub` CLI, Action, importação do próprio Hub como teste (D10) | Sessão de Claude Code fecha tarefa via CLI e aparece no quadro |
| **M5** Agentes de gestão e importação | Papéis de gestão no Kratos (D6); Concierge e Planejador no app com IA multi-provedor (D5); importação de todos os projetos por agente, com revisão do Fábio (D10) | Digest matinal real no Telegram; rascunho de status gerado; projetos importados e aprovados |
| **M6** Portal e relatórios | Portal do cliente, Redator do Cliente, relatórios aprovados, e-mail | Cliente piloto acessa o portal; teste de vazamento verde |
| **M7** Departamentos e visões avançadas | Linha do tempo, calendário, tabela, painel, visões salvas, templates, tempo | Visão por departamento usada na revisão mensal |
| **M8** Operação e segurança | Backups, observabilidade, hardening, LGPD, runbook | Restauração testada; auditoria de acesso |
| **M9** Produto replicável · **adiado (D7)** | Só depois de validado e com nova decisão do Fábio: multi-workspace, onboarding de novo workspace, white-label, pacote de implantação, oferta | Segundo workspace de teste criado do zero em < 1 dia |

---

## 18. Modelo de replicação e venda

> **Adiado (D7, 2026-10-09):** o Hub é de uso interno da Harmony. Esta seção fica como referência para quando o Fábio validar o sistema e decidir se vai comercializar. O único cuidado mantido desde já é técnico e sem custo extra: marca, departamentos, templates e agentes como configuração, nada fixo no código.

- **Unidade vendida**: uma instância do Hub para uma empresa (workspace), com branding próprio, departamentos, templates e agentes configurados. Opções técnicas: (a) container próprio + schema próprio no Supabase do cliente ou da Harmony; (b) container próprio + Supabase dedicado (como RELGOV) para clientes com exigência de isolamento.
- **O que é configuração, não código**: nome, logo, cores, domínio, departamentos, status padrão, templates, textos padrão do portal, agentes e seus prompts base, rituais (horários, dias), limites de IA.
- **Pacote de implantação** (M9): script `hub init-workspace`, checklist de DNS/Traefik/segredos, migrações, carga de templates, criação dos agentes no Hermes do cliente ou gerenciados pela Harmony.
- **Modelos comerciais a decidir pelo Fábio** (D7 e após M9): licença + implantação; assinatura mensal com agentes gerenciados pela Harmony; coprodução. Sem valores neste PRD.
- **A Harmony é o caso de referência**: tudo que for aprendido operando o próprio Hub vira template e argumento comercial. Nenhum nome de cliente aparece no produto vendido.

---

## 19. Decisões do Fábio (tomadas em 2026-10-09)

Respostas do Fábio às decisões D1–D11, espelhadas em `PLAN.md`. Mudanças futuras entram como linha nova no Registro de Execução do `PLAN.md`.

| # | Decisão | O que foi decidido |
|---|---|---|
| D1 | Domínio | `hub.harmonydigital.com.br`. Um endereço mais amigável só para o portal do cliente pode ser somado depois |
| D2 | Banco | Supabase self-hosted compartilhado, schema `proj_hub_gestao` |
| D3 | Framework | Next.js 16, o mesmo do Certato, do IA Posicionamento e da Redação ACM, com o pipeline GitHub Actions → VPS já provado |
| D4 | Tema | Claro por padrão; "Sala de Controle" escuro no console dos agentes e como opção |
| D5 | IA dos agentes internos | Multi-provedor por agente: Anthropic (Claude), OpenAI ou xAI (Grok). O Fábio troca provedor, modelo e chave na tela Agentes, quando quiser. Teto inicial de US$ 30/mês somados, editável |
| D6 | Agente de gestão no Hermes | Fase 1: os papéis de gestão são skills do Kratos. Agente dedicado só se o Fábio decidir depois; no Hub basta outra chave |
| D7 | Produto comercial | Não por enquanto: uso interno. Reavaliar depois de validado. M9 adiado |
| D8 | Backups | `pg_dump` diário do schema a partir do M2, snapshot semanal da VPS, cópia fora da VPS e teste mensal de restauração |
| D9 | Portal do cliente | Só por convite: entra quem o Fábio cadastrar, quando ele liberar o acesso. O aceite de marco continua com o Fábio |
| D10 | Importação dos projetos | Todos os projetos, depois do Hub pronto, importados por agente (Kratos, ou Claude Code para o que só existe no Mac) com orientação do Fábio; cada projeto entra `in_review` até o ok dele |
| D11 | Publicar cedo | Sim: endereço definitivo no M2, protegido por login, mesmo com poucas telas prontas |

---

## 20. Glossário

Ver `AGENTS.md` §14.
