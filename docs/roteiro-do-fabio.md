# Roteiro do Fábio: o que falta para fechar o PLAN.md

> Atualizado em 2026-10-11, à noite. **A construção terminou:** tudo o que cabe ao agente no `PLAN.md`, inclusive as lacunas do PRD (PRs até #114), está feito e no ar. **A fase agora é de testes de uso** (seção 0) e dos passos abaixo, que só o Fábio faz. O que aparecer nos testes vira correção do agente, um PR por correção. O passo 1 registra as decisões já tomadas; os outros dependem de um acesso ou de uma aprovação do Fábio, e cada um diz qual item do `PLAN.md` fecha. A ordem vai do que destrava mais para o que destrava menos. O detalhe de cada passo está no documento indicado; aqui fica só o caminho.

## 0. Testes de uso: por onde começar

Dá para testar tudo sem importar os projetos oficiais, num projeto de teste criado na própria tela. O que for estranho, lento ou confuso: anotar e mandar no chat (de preferência com a tela e o que você esperava), e o agente corrige.

1. **Um projeto de teste:** Projetos → Novo projeto, a partir de um modelo (Modelos de projeto). Conferir a importação do esqueleto, a Visão geral nas três camadas, a ordem dos marcos e o GATE de cada marco.
2. **O dia a dia das tarefas:** Lista e Quadro (arrastar, raias, filtros, visões salvas, a visão de cada departamento), o painel da tarefa (checklist, anexos até 25 MB, etiquetas, dependências, comentários com @menção, tempo), os atalhos de teclado (`?` mostra a lista) e a busca `⌘K`.
3. **Decisões:** Hoje (riscos com a ação sugerida, o que espera você) e Aprovações (pedir aceite de um marco e decidir). O histórico de marco, frente, projeto e cliente mostra quem fez o quê.
4. **Equipe:** Configurações (Equipe, departamentos, etiquetas, retenção) e, no Editar projeto, as Pessoas no projeto (o convidado só acompanha).
5. **Portal, com um contato de teste seu** (um e-mail seu, nunca de cliente): Clientes → Contatos e portal → liberar o acesso, entrar pelo link num navegador anônimo, aceitar o uso dos dados e ver o projeto como o cliente vê.
6. **Agentes:** o Claude Code já opera pelo MCP (`hub_list_tasks`, `hub_notify`, `hub_get_milestone`…); a Sala de Controle mostra o que ele fez e o custo.

Com o e-mail do Hub ligado (passo 3, `docs/email.md`) passam a funcionar: o convite do portal e o da equipe por e-mail, o link novo que o contato pede sozinho e o relatório aprovado por e-mail aos contatos. Com a chave de IA (passo 3, `docs/ia.md`): o Concierge, o Planejador e o Redator do Cliente.

A semana de uso real de um projeto fecha o GATE M3 (seção 7).

## 1. Decisões (tomadas no chat em 2026-10-11)

| Decisão | Resultado | Fecha |
|---|---|---|
| Varredura de segredos e proteção de envio do GitHub | ligadas pelo agente e conferidas (nenhum alerta aberto) | segurança do repositório público |
| Proteção da `main` | ligada: PR obrigatório com os três jobs do CI, sem force-push, também para administradores; vale enquanto o repositório for público | M0, "Proteção da branch `main`" |
| Acesso de `PUBLIC` ao `pg_net` e às estatísticas no Supabase compartilhado | manter (o Hub não usa; `docs/seguranca.md`) | pendência da revisão de segurança (M8) |
| Destino da cópia diária do backup fora da VPS (D8) | Google Drive, por rclone, cifrada; o instalador está no passo 2. **Suspenso** pelo Fábio em 2026-10-11, junto com o teste de restauração ("não precisa do backup agora"); o dump diário na VPS continua | M2 (D8) e M8, "Backups" |
| Quando fechar o repositório | depois dos GATEs, com o CI resolvido (plano pago, limite de gastos ou CI mais enxuto) | Encerramento |

## 2. Um clique no Mac (botão Rodar, na pasta do repositório)

| Passo | Comando | Fecha |
|---|---|---|
| Ligar o aviso de publicação que falhou | `deploy/vps/hub-alert-secret.sh` | M8, "Observabilidade" (junto com o Telegram, passo 4) |
| ~~Aplicar a rotação dos logs do contêiner~~ | feito em 2026-10-11 pelo agente, com o ok do Fábio (`deploy/vps/hub-apply-compose.sh`) | M8, "LGPD" (falta a revisão jurídica, passo 6) |
| Ligar a cópia diária do backup no Google Drive (o navegador abre para autorizar com a conta Google da Harmony). **Suspenso** (decisão de 2026-10-11) | `deploy/vps/hub-backup-offsite-setup.sh`, quando retomar | M2 (D8) e M8, "Backups" |
| Teste de restauração do backup. **Suspenso** (decisão de 2026-10-11) | os dois comandos de `docs/operacao.md`, "Teste de restauração", quando retomar | M8, "Backups" e GATE M8 |

## 3. Na tela do Hub, como dono

| Passo | Onde | Fecha |
|---|---|---|
| Importar o `PLAN.md` no projeto HUB | Projetos → HUB → Editar projeto → Importar o plan.md (a prévia mostra tudo antes de gravar) | M4, "Importar este `PLAN.md`"; depois disso o agente faz a primeira sessão pela CLI (M4, "Primeira sessão de Claude Code") |
| Chave de IA e agentes internos: Concierge (CO-10), Planejador (PL-11) e Redator do Cliente (RC-12), pode ser um agente só com os três papéis | Sala de Controle → Nova chave de IA; Cadastrar agente, com os papéis; janela "Modelo de IA" do agente, com o modelo, os preços e o teto, e Testar conexão. Passo a passo, modelos Claude e preços em `docs/ia.md` | M5, teste real por provedor (D5); destrava a tarefa por voz do GATE M5 e o RC-12 do M6 |
| Cadastrar o Kratos e a chave dele (escopos de gestão e `projects:import`, `AGENTES.md` §4). Em 2026-10-11 o único agente cadastrado em produção é o Claude Code do Fábio | Sala de Controle → Cadastrar agente, com os papéis de gestão; depois, Criar chave (aparece uma vez; vai direto para o Kratos, nunca para o chat) | M5, "(D6) Uma chave de agente para o Kratos" |
| Agentes EX-09 ("Executor de Dados") e N8-17 ("n8n Bridge", chave só `tasks:write` nos projetos dos fluxos) | Sala de Controle → Cadastrar agente e Criar chave para cada um; o fluxo do n8n em `docs/n8n.md` | M7, "EX-09 e N8-17" |
| Webhook para o Hermes (avisos no Telegram) | Sala de Controle → Webhooks de saída, com o endereço da assinatura do Hermes (`docs/webhooks.md`) | M5, "Webhook do Hub → Hermes → Telegram"; M8, "Observabilidade" |
| Ligar o e-mail do Hub: domínio no Resend, registros de DNS (com a sua ordem; o agente pode criar pela API da Hostinger), chave de envio e o script de um clique | `docs/email.md` e `deploy/vps/hub-email-setup.sh`; conferir com "Enviar um e-mail de teste para mim" em Configurações | Lacunas do PRD, RF-05, RF-33, RF-34 e RF-03: convite do portal e da equipe por e-mail, link novo pedido pelo contato e relatório aprovado por e-mail |
| Cliente piloto: contato, liberar o portal e mandar o convite | Clientes → o cliente → Contatos e portal (`docs/portal.md`) | GATE M6 |

## 4. No Hermes e no Kratos (contêiner do Hermes na VPS)

| Passo | Como | Fecha |
|---|---|---|
| Conferir a versão e a configuração do Hermes | `hermes --version`, `hermes webhook list`, `hermes cron list` dentro do contêiner (`agents/hermes/README.md`) | M5, "Confirmar na instalação da VPS como registrar servidores MCP e crons" |
| Skills de gestão no segundo cérebro e no Kratos | copiar `agents/hermes/skills/gestao-hub/` e marcar os papéis no cadastro do Kratos | M5, "(D6) Papéis de gestão como skills do Kratos" |
| Rotinas: digest matinal, status de segunda, verificação noturna, resumo do dia, o TO-15 (segunda, 9h30) e o AC-14 (segunda, 10h) | `hermes cron create` (`agents/hermes/README.md`) | M5, "Crons"; M7, "TO-15"; M8, AC-14 no Kratos |
| Assinatura de webhook do Hub para o Telegram | `hermes webhook subscribe` (`docs/webhooks.md`) | M5 e M8 (Telegram) |
| Teste "como está o projeto X?" | pelo Telegram, com a chave do Kratos | M5, "Kratos com chave de leitura" |

## 5. Importação dos projetos (D10)

1. Sessão de orientação: o Fábio explica como quer os projetos estruturados; a orientação entra na skill `agents/skills/importar-projetos-no-hub/SKILL.md`.
2. Acesso de leitura do Kratos aos repositórios da Harmony no GitHub, sem escrita.
3. O Kratos importa os projetos do GitHub; os que só existem em pasta no Mac, uma sessão do Claude Code importa com a mesma ferramenta.
4. Revisão de cada importação no Hoje (aprovação em lote quando houver duas ou mais).

Fecha os itens de "Importação de todos os projetos" do M5 e parte do GATE M5.

## 6. Sincronização e GitHub (M4, depois da importação do passo 3)

- Chave de sincronização do HUB no segredo `HUB_SYNC_KEY` e a variável `HUB_SYNC_ENABLED` (`docs/cli.md`). Fecha M4, "GitHub Action reutilizável `hub-sync.yml`".
- Opcional: webhook do GitHub (`docs/github-webhook.md`), para commits e PRs que citam `HUB-n` aparecerem na tarefa.
- Revisão jurídica das bases legais de `docs/privacidade.md`. Fecha, com a rotação dos logs, o item "LGPD" do M8.

## 7. Uso real e GATEs (só o Fábio aprova)

| GATE | Critério do plano |
|---|---|
| M3 | uma semana operando um projeto real pela interface |
| M4 | projeto HUB sincronizado; uma sessão de código fecha tarefa e o quadro reflete |
| M5 | uma semana de digests no Telegram; um replanejamento do GP-01 decidido no Hoje; uma tarefa criada por voz pelo Concierge; todos os projetos ativos importados e aprovados |
| M6 | cliente piloto acessa o portal, recebe o primeiro status aprovado e comenta; teste de vazamento verde (já verde no CI) |
| M7 | revisão mensal de portfólio na visão por departamento; um projeto criado de modelo |
| M8 | restauração testada e registrada; auditoria de acesso lida e ações decididas (o primeiro aviso semanal do auditor chegou em 2026-10-11, sem pontos) |

## 8. Encerramento

Fechar o repositório (voltar a privado), depois da decisão do passo 1 sobre o CI. O M9 (produto replicável) continua adiado pela D7.
