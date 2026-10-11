# Roteiro do Fábio: o que falta para fechar o PLAN.md

> Atualizado em 2026-10-11. Tudo o que cabe ao agente está feito e no ar. O passo 1 registra as decisões já tomadas; os outros dependem de um acesso ou de uma aprovação do Fábio, e cada um diz qual item do `PLAN.md` fecha. A ordem vai do que destrava mais para o que destrava menos. O detalhe de cada passo está no documento indicado; aqui fica só o caminho.

## 1. Decisões (tomadas no chat em 2026-10-11)

| Decisão | Resultado | Fecha |
|---|---|---|
| Varredura de segredos e proteção de envio do GitHub | ligadas pelo agente e conferidas (nenhum alerta aberto) | segurança do repositório público |
| Proteção da `main` | ligada: PR obrigatório com os três jobs do CI, sem force-push, também para administradores; vale enquanto o repositório for público | M0, "Proteção da branch `main`" |
| Acesso de `PUBLIC` ao `pg_net` e às estatísticas no Supabase compartilhado | manter (o Hub não usa; `docs/seguranca.md`) | pendência da revisão de segurança (M8) |
| Destino da cópia diária do backup fora da VPS (D8) | Google Drive, por rclone; o agente prepara o script de um clique (passo 2) | M2 (D8) e M8, "Backups" |
| Quando fechar o repositório | depois dos GATEs, com o CI resolvido (plano pago, limite de gastos ou CI mais enxuto) | Encerramento |

## 2. Um clique no Mac (botão Rodar, na pasta do repositório)

| Passo | Comando | Fecha |
|---|---|---|
| Ligar o aviso de publicação que falhou | `deploy/vps/hub-alert-secret.sh` | M8, "Observabilidade" (junto com o Telegram, passo 4) |
| Aplicar a rotação dos logs do contêiner | `deploy/vps/hub-apply-compose.sh` | M8, "LGPD" (junto com a revisão jurídica, passo 6) |
| Teste de restauração do backup | os dois comandos de `docs/operacao.md`, "Teste de restauração" | M8, "Backups" e GATE M8 |

## 3. Na tela do Hub, como dono

| Passo | Onde | Fecha |
|---|---|---|
| Importar o `PLAN.md` no projeto HUB | Projetos → HUB → Editar projeto → Importar o plan.md (a prévia mostra tudo antes de gravar) | M4, "Importar este `PLAN.md`"; depois disso o agente faz a primeira sessão pela CLI (M4, "Primeira sessão de Claude Code") |
| Chave de IA e agentes internos: Concierge (CO-10), Planejador (PL-11) e Redator do Cliente (RC-12), pode ser um agente só com os três papéis | Sala de Controle → Nova chave de IA; Cadastrar agente, com os papéis; janela "Modelo de IA" do agente, com o modelo, os preços e o teto, e Testar conexão | M5, teste real por provedor (D5); destrava a tarefa por voz do GATE M5 e o RC-12 do M6 |
| Cadastrar o Kratos e a chave dele (escopos de gestão e `projects:import`, `AGENTES.md` §4). Em 2026-10-11 o único agente cadastrado em produção é o Claude Code do Fábio | Sala de Controle → Cadastrar agente, com os papéis de gestão; depois, Criar chave (aparece uma vez; vai direto para o Kratos, nunca para o chat) | M5, "(D6) Uma chave de agente para o Kratos" |
| Agentes EX-09 ("Executor de Dados") e N8-17 ("n8n Bridge", chave só `tasks:write` nos projetos dos fluxos) | Sala de Controle → Cadastrar agente e Criar chave para cada um; o fluxo do n8n em `docs/n8n.md` | M7, "EX-09 e N8-17" |
| Webhook para o Hermes (avisos no Telegram) | Sala de Controle → Webhooks de saída, com o endereço da assinatura do Hermes (`docs/webhooks.md`) | M5, "Webhook do Hub → Hermes → Telegram"; M8, "Observabilidade" |
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
