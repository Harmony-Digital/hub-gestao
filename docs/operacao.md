# Operação do Hub (runbook)

O que olhar e o que fazer quando algo no Hub de produção (`https://hub.harmonydigital.com.br`, VPS `vps-harmony`) não está bem. Os comandos de servidor são do Fábio (ou de quem ele autorizar), com o botão Rodar; o agente só lê. Mudança em DNS, Traefik, Compose ou systemd continua exigindo a ordem do Fábio.

## Publicação

Todo merge na `main` vai para produção. O workflow "Qualidade" roda na `main`; com ele verde, o "Publicação na VPS" constrói a imagem do commit, entrega na VPS, troca o contêiner e espera ficar saudável. Se a versão nova não ficar saudável, a anterior volta sozinha. No fim, o workflow confere que `/api/health` responde com o commit publicado (o SHA inteiro em `version`).

- **Acompanhar:** GitHub → Actions → "Publicação na VPS", ou `gh run list -R Harmony-Digital/hub-gestao --workflow "Publicação na VPS" --limit 3`.
- **Conferir:** `curl -s https://hub.harmonydigital.com.br/api/health`, com `version` igual ao commit do merge e `status` em `ok`.
- **Migração de banco:** entra antes do merge, pelo conector `harmony-supabase` (`apply_migration`, prefixo `hub_gestao_`), e é sempre aditiva (tabela nova, coluna nova que aceita vazio). Assim a versão anterior continua funcionando se a publicação voltar.
- **Publicar de novo o mesmo commit:** Actions → "Publicação na VPS" → Run workflow, na `main`.
- **Falhou:** o Hub segue na versão anterior. Se o `HUB_ALERT_SECRET` estiver ligado, o dono recebe o aviso (seção Alertas). O log do passo que falhou está na execução do workflow.

## Voltar uma versão

1. **O caminho certo:** reverter o PR no GitHub (botão Revert), deixar o CI passar e juntar o PR de reversão. A publicação leva a versão anterior, como qualquer outra. O banco fica como está: as migrations são aditivas, e desfazer uma migration é migration nova, nunca apagar à mão.
2. **Emergência** (o Hub está fora e a volta automática não aconteceu). A VPS guarda a imagem anterior; com a ordem do Fábio, entrar na VPS (`ssh -t vps-harmony`) e rodar:

   ```bash
   sudo cat /opt/hub-gestao/shared/previous-sha
   sudo env HUB_IMAGE_TAG=<o SHA de cima> docker compose --env-file /opt/hub-gestao/shared/.env.production --file /opt/hub-gestao/config/docker-compose.yml up --detach --no-build
   ```

   Conferir `/api/health` (a `version` volta a ser a anterior). Depois, levar a correção ou a reversão pelo caminho normal: a publicação seguinte acerta os registros de versão da VPS.

## Saúde (`/api/health`)

```bash
curl -s https://hub.harmonydigital.com.br/api/health
```

| Campo | O que diz |
|---|---|
| `ok` | O processo respondeu. É o que o contêiner (a cada 15 segundos) e a publicação conferem, junto com a versão: com o banco fora, continua `true` |
| `version` | O commit publicado (SHA). Tem de ser o da última publicação verde |
| `status` | `ok`; `degraded` (o banco responde, mas a fila de jobs parou ou teve falha nas últimas 24 horas); `down` (o banco não respondeu em 2,5 segundos) |
| `checks.database` | `ok` ou `down` |
| `checks.queue` | `ok`; `stalled` (nenhum ciclo do relógio há mais de 15 minutos, ou job atrasado na fila); `failing` (algum job esgotou as tentativas nas últimas 24 horas); `unknown` (o relógio ainda não rodou, como no computador de quem programa) |

A resposta é guardada por 20 segundos, para a pergunta do contêiner não pesar no banco: depois de corrigir, espere esse tempo antes de conferir de novo. A resposta não traz números nem nomes (o endereço é público); o detalhe fica na Sala de Controle.

Para monitorar de fora (opcional, passo do Fábio): uma rotina no Hermes (Kratos) ou um serviço de monitoramento que leia `/api/health` a cada 15 minutos e avise no Telegram quando `status` não for `ok`. Esse é o único jeito de saber que o relógio parou sem abrir o Hub: com o relógio parado, os webhooks do próprio Hub também param.

## Relógio dos jobs parado

Sinais: `checks.queue` em `stalled` e, na Sala de Controle (`/agentes`), o aviso "O relógio dos jobs está parado". Enquanto isso, os avisos, a entrega dos webhooks, o recálculo da saúde dos projetos e a reescrita do texto para o cliente esperam; nada se perde, os jobs ficam na fila.

O relógio é o timer `hub-cron` do systemd, que a cada 5 minutos roda `docker exec hub-app node /app/scripts/cron-tick.mjs` (o script chama `POST /api/internal/cron/tick` com o `CRON_SECRET` do contêiner).

1. O timer está ativo e quando rodou por último:

   ```bash
   ssh vps-harmony 'sudo systemctl status hub-cron.timer hub-cron.service --no-pager'
   ```

2. O que a última rodada disse (o resultado de cada job, ou o erro):

   ```bash
   ssh vps-harmony 'sudo journalctl -u hub-cron.service --since "-1 hour" --no-pager'
   ```

3. O contêiner está de pé e saudável (sem ele, a rodada é pulada):

   ```bash
   ssh vps-harmony 'sudo docker ps --filter name=hub-app --format "{{.Names}} {{.Status}}"'
   ```

4. Rodar uma rodada na hora, para conferir:

   ```bash
   ssh vps-harmony 'sudo systemctl start hub-cron.service && sudo journalctl -u hub-cron.service -n 20 --no-pager'
   ```

Causas comuns: timer desligado depois de um reinício da VPS (`sudo systemctl enable --now hub-cron.timer`, com a ordem do Fábio), contêiner fora (ver a publicação), `CRON_SECRET` ausente ou diferente no `.env.production` (o log diz "CRON_SECRET ausente" ou o relógio responde 401).

## Job com falha

Sinais: `checks.queue` em `failing` e, na Sala de Controle, a lista "Jobs com falha nas últimas 24 horas", com o job e o começo do erro. Um job tenta de novo com espera crescente e só falha de vez depois de 5 tentativas (a entrega de webhook, depois de 8, por aviso).

- **Entrega dos webhooks**: o receptor não respondeu 2xx. Veja a lista "Últimos avisos" em Webhooks de saída (Sala de Controle) e o receptor (Hermes, n8n). `docs/webhooks.md`.
- **Gasto de IA, recálculo da saúde, conferência de evidências, aprovações paradas**: o erro vem do banco ou de um dado inesperado. Leia o log do contêiner (seção Logs) com o horário da falha e abra uma tarefa no projeto HUB com o erro.
- **Reescrita do texto para o cliente (RC-12)**: o provedor de IA falhou ou a resposta veio fora do formato; o pedido de aprovação continua com o texto original. Confira a chave e o modelo do Redator na Sala de Controle.

## Alertas

O Hub avisa o dono na caixa de entrada (grupos "Agentes" e "Operação do Hub") e os webhooks de saída (Telegram, pelo Hermes; `docs/webhooks.md`):

| Alerta | Quando | Evento |
|---|---|---|
| Orçamento de IA acabou | um agente (ou o teto do workspace) passou do orçamento do mês; um por dia | `agent.budget_exceeded` |
| Recusas de acesso repetidas | 5 ou mais recusas da mesma chave numa hora (o relógio confere a cada 15 minutos); um por dia por agente. Veja "Recusas de acesso" na Sala de Controle: chave revogada (401), escopo que falta (403) ou agente pausado (423) | `agent.denials_recurring` |
| Job falhou de vez | um job do relógio esgotou as tentativas; um por job | `system.job_failed` |
| Publicação falhou | o workflow "Publicação na VPS" falhou em algum passo; a versão anterior continua no ar; um por commit | `system.deploy_failed` |

O relógio parado não vira alerta pelo Hub (com ele parado, nem os webhooks saem): ele aparece na saúde e na Sala de Controle (seção "Relógio dos jobs parado").

**Ligar o aviso de publicação** (passo do Fábio, uma vez; rodar de novo troca o segredo): no Mac, na pasta do repositório,

```bash
deploy/vps/hub-alert-secret.sh
```

O script gera o segredo, grava no `/opt/hub-gestao/shared/.env.production` da VPS pelo `hub-env-set.sh` (o valor vai pela entrada padrão, nunca na linha de comando, e o arquivo mantém dono e permissão), recria o contêiner na versão no ar (alguns segundos fora do ar), guarda o mesmo valor no segredo `HUB_ALERT_SECRET` do repositório no GitHub e confere que a rota do aviso passou a recusar pedido sem o segredo (401). O valor não aparece na tela nem fica no Mac. À mão, o mesmo: gerar com `openssl rand -hex 32`, acrescentar `HUB_ALERT_SECRET=<o segredo>` ao `.env.production`, recriar o contêiner e criar o segredo no GitHub (Settings → Secrets and variables → Actions).

Sem o segredo, o último passo do workflow só diz que o aviso está desligado e a publicação segue como antes.

## Backup e restauração

| O quê | Quando | Onde |
|---|---|---|
| Dump do schema `proj_hub_gestao` (`hub-backup.timer`) | todo dia, 06:00 UTC (03:00 em Brasília) | `/opt/hub-gestao/backups/hub-<data>.dump`, 14 dias |
| Backup da VPS inteira (Hostinger) | semanal | fora da VPS, no servidor de backup da Hostinger (vistos em 03/10 e 10/10/2026 pela API) |
| Cópia diária do dump fora da VPS | — | destino a escolher pelo Fábio (D8) |

Conferir o backup diário:

```bash
ssh -t vps-harmony 'sudo systemctl status hub-backup.timer --no-pager; sudo ls -lh /opt/hub-gestao/backups | tail -n 5'
```

**Teste de restauração** (uma vez por mês; passo do Fábio). O script restaura o dump mais recente num banco temporário do mesmo Postgres, compara as contagens de cada tabela com a produção (só leitura) e apaga o banco temporário no fim. Na tela, só nomes de tabela e contagens:

```bash
scp deploy/vps/hub-restore-test.sh vps-harmony:/tmp/hub-restore-test.sh
```

```bash
ssh -t vps-harmony 'sudo bash /tmp/hub-restore-test.sh'
```

A última linha diz "OK" com o número de tabelas e linhas, e o resultado fica em `/opt/hub-gestao/backups/restauracoes.log`. Registrar no `PLAN.md` a data e o resultado. Contagens um pouco diferentes da produção são normais: o dump é de até 24 horas atrás.

**Restaurar de verdade** (perda ou estrago de dados; só com o Fábio, em hora combinada). Tudo o que foi gravado depois do dump escolhido se perde.

1. Avisar a equipe. Parar o relógio e o Hub: `sudo systemctl stop hub-cron.timer` e `sudo docker stop hub-app` (o endereço mostra erro até voltar).
2. Guardar o estado atual, mesmo estragado: `sudo /opt/hub-gestao/bin/hub-backup.sh`.
3. Testar o dump escolhido com o teste de restauração (acima), passando o caminho dele.
4. Restaurar sobre o schema de produção:

   ```bash
   sudo docker exec -i supabase-db pg_restore --host=127.0.0.1 --username=postgres --dbname=postgres --clean --if-exists --no-owner --no-privileges --exit-on-error < /opt/hub-gestao/backups/hub-<data>.dump
   ```

5. Devolver as permissões do papel do Hub, que somem com a troca do schema (o dump é feito sem permissões). Copiar `deploy/vps/hub-db-grants.sql` para `/tmp` da VPS (como o script acima) e rodar:

   ```bash
   sudo docker exec -i supabase-db psql --host=127.0.0.1 --username=postgres --dbname=postgres < /tmp/hub-db-grants.sql
   ```

6. Se o dump for anterior a alguma migration, aplicar de novo as migrations que vieram depois dele, pelo conector, antes de subir.
7. Subir e conferir: `sudo docker start hub-app`, `sudo systemctl start hub-cron.timer`, `/api/health` com `status` em `ok` e as telas.
8. Registrar no `PLAN.md`: a data, o dump usado e o motivo.

Ensaio em 2026-10-11, num Postgres 16 descartável no computador, com as 20 migrations e os seeds:

- O teste de restauração passou: 45 tabelas, contagens iguais à origem e o banco temporário apagado.
- A restauração completa com `--clean` também passou: o dado gravado depois do dump sumiu, como esperado.
- As permissões do papel do Hub sumiram com a troca do schema e voltaram com o `hub-db-grants.sql`.
- RLS e as 76 políticas voltaram junto.

## Pausar um agente

- **Pausar:** Sala de Controle → o agente → Pausar. Toda chamada dele passa a receber 423 e aparece em "Recusas de acesso". Reativar desfaz.
- **Revogar uma chave:** Sala de Controle → a chave → Revogar. Dali em diante, 401. Não tem volta: para continuar, gere outra chave.
- **Agente interno com IA** (Concierge, Planejador, Redator): pausar o agente ou revogar a chave de IA dele (Chaves de IA). As telas passam a dizer que a IA está desligada, e o resto do Hub segue (falha fechada).

## Auditoria semanal e rotação de chaves

Toda segunda, o Hub confere as chaves, os acessos e os custos e deixa o aviso "Auditoria semanal" na caixa de entrada do dono. A tela é `/agentes/auditoria` (atalho na Sala de Controle). Cada ponto vem com o que fazer, e quem faz é o dono: o Hub não revoga nem troca nada sozinho, só recusa as chaves vencidas.

Política de rotação:

- **Chave de agente:** trocar a cada 90 dias. Revogar a que está parada há 30 dias ou a que nunca foi usada depois de 14. Gerar a próxima antes de vencer. Na troca de pessoa responsável pelo agente, trocar na hora.
- **Chave de IA do provedor:** trocar a cada 180 dias, e na hora em que alguém que teve acesso a ela sair.
- **Segredos do servidor** (`CRON_SECRET`, `HUB_ALERT_SECRET`, `GITHUB_WEBHOOK_SECRET` e os segredos de webhook): trocar quando alguém com acesso à VPS ou ao GitHub sair, ou em suspeita de vazamento.
- **Acesso de pessoa da equipe:** suspender quando ela sair. A auditoria aponta quem não grava nada há 60 dias.
- **Contato do portal:** revogar quando deixar de acompanhar o projeto. A auditoria aponta o acesso parado há 90 dias.

Como trocar cada um: seção seguinte.

## Trocar um segredo

Em suspeita de vazamento, trocar primeiro e investigar depois. Registrar a troca no `PLAN.md`, sem o valor. Depois de mudar o `.env.production`, recriar o contêiner para ele ler de novo (com a ordem do Fábio; a próxima publicação também recria):

```bash
sudo env HUB_IMAGE_TAG=$(sudo cat /opt/hub-gestao/shared/current-sha) docker compose --env-file /opt/hub-gestao/shared/.env.production --file /opt/hub-gestao/config/docker-compose.yml up --detach --no-build --force-recreate
```

| Segredo | Como trocar | Efeito |
|---|---|---|
| Chave de agente (`hub_ak_…`) | Sala de Controle: gerar outra, pôr no agente (Hermes, Claude Code, n8n) e revogar a antiga | só aquele agente |
| Chave de IA do provedor | Sala de Controle → Chaves de IA → trocar; revogar a antiga no site do provedor | os agentes que usam aquela chave |
| Segredo de webhook (`whsec_…`) | Webhooks de saída → Trocar segredo; pôr o novo no receptor (Hermes, n8n) | o antigo para na hora |
| `CRON_SECRET` | gerar (`openssl rand -hex 32`), trocar no `.env.production` e recriar o contêiner (o relógio lê do próprio contêiner) | nenhum |
| `HUB_ALERT_SECRET` | trocar no `.env.production` e no segredo do repositório no GitHub, com o mesmo valor | nenhum |
| `GITHUB_WEBHOOK_SECRET` | trocar no `.env.production` e no campo Secret de cada webhook nos repositórios (`docs/github-webhook.md`) | eventos do GitHub recusados até os dois baterem |
| `HUB_API_KEY_PEPPER` | só em vazamento confirmado: trocar e recriar o contêiner | **invalida todas as chaves de agente e todos os links e sessões do portal**: gerar chave nova para cada agente e link novo para cada contato |
| `HUB_ENCRYPTION_KEY` | trocar e recriar o contêiner | as chaves de IA e os segredos de webhook guardados ficam ilegíveis: recadastrar as chaves de IA e trocar o segredo de cada webhook |
| Senha do banco (`DATABASE_URL`) | tirar a linha `DATABASE_URL` do `.env.production`, rodar `hub-db-provision.sh` (gera a senha nova, troca no banco e grava a linha nova) e recriar o contêiner na hora | entre a troca e a recriação, o Hub fica sem banco |
| Chave SSH de publicação | `hub-provision-local.sh` gera outra, troca na VPS e no GitHub (`deploy/vps/README.md`) | publicações param até terminar |
| Sessão de alguém da equipe | Supabase Studio → Authentication → o usuário → Ban user (o Hub confere a sessão a cada tela, então ela cai na hora); para voltar, desbloquear, e a pessoa troca a própria senha em `/conta`. Só o acesso ao Hub, sem mexer no login dos outros sistemas: Suspender em Configurações → Equipe (só o dono) | só aquela pessoa |

## Incidente de vazamento de dados

1. **Conter (primeira hora):**
   - revogar ou pausar o que pode ter vazado e trocar os segredos envolvidos (seções acima);
   - acesso indevido de pessoa: bloquear o usuário no Supabase Studio (Authentication → o usuário → Ban user). O Hub confere a sessão no Supabase a cada tela, então ela cai na hora. Para tirar só o acesso ao Hub (o login do Supabase vale para outros sistemas da Harmony): Suspender em Configurações → Equipe, só o dono; a pessoa sai na próxima tela que abrir e o histórico dela continua;
   - contato de cliente: Revogar em Clientes → Contatos e portal.
2. **Entender:**
   - o que foi feito e por quem: o histórico (exportar a atividade do período no Painel ou em Projetos), a Sala de Controle (feed e recusas de acesso) e os logs do contêiner, que dão o `request_id` de cada pedido;
   - por onde entrou: chave, sessão ou falha de código.
3. **Avaliar se há dado pessoal envolvido:** contatos de cliente, e-mails da equipe, conteúdo de projeto de cliente.
4. **Comunicar:** decisão do Fábio, que representa a Harmony como controladora.
   - **Incidente que possa trazer risco ou dano relevante aos titulares:** a LGPD (art. 48) pede comunicar a ANPD e os titulares. O regulamento da ANPD (Resolução CD/ANPD nº 15/2024) dá até 3 dias úteis a partir do conhecimento do incidente, com até 20 dias úteis para completar as informações. Conferir com orientação jurídica, inclusive se cabe o prazo diferenciado de agente de pequeno porte.
   - **Cliente afetado:** avisar também, com o texto aprovado pelo Fábio.
5. **Registrar:** no `PLAN.md` (Registro de Execução) e numa tarefa no projeto HUB, com o que aconteceu, o que foi feito e o que muda para não repetir. Depois, rodar de novo a varredura de segredos do repositório.

## Teste de carga

Meta do M8: Lista e Quadro com 5 mil tarefas num projeto, p95 abaixo de 400 ms. Medido em 2026-10-11, num Postgres 16 descartável no computador (as 20 migrations e os seeds), com 5 mil tarefas no projeto de exemplo CRG (4 mil abertas, mil concluídas, 12 frentes, 300 dependências):

| Medida | Lista | Quadro |
|---|---|---|
| Dados da tela (`src/test/carga.test.ts`, a transação da tela com o papel do app e a RLS) | p95 de 11 a 17 ms, com e sem filtros | p95 19 ms |
| Página inteira, versão de produção (`next build`), resposta do servidor | p95 50 ms, 1,2 MB (antes: 129 ms e 3,5 MB) | p95 46 ms, 1 MB |
| Página inteira, modo de desenvolvimento | p95 0,9 s (antes: 1,9 s) | p95 0,25 s |

A Lista pesava por causa das linhas: cada célula editável era um formulário com campos escondidos, e cada linha levava as listas de opções inteiras. Agora a célula chama a ação direto (`editarCampoNaLista`), as opções vão uma vez para a tela (`ListOptionsProvider`) e a Lista mostra as primeiras 200 tarefas abertas, com "Mostrar mais" (até mil). O Quadro mostra até 500 abertas.

Para repetir (no computador, nunca na produção: o teste cria o projeto CRG):

1. Um Postgres descartável com as migrations e os seeds. Com o Postgres do Homebrew: `initdb -D <pasta> -U postgres --auth=trust`; `LC_ALL=C pg_ctl -D <pasta> -o "-p 55432 -c unix_socket_directories='' -c listen_addresses=127.0.0.1" start`; `create schema proj_hub_gestao`; depois cada arquivo de `supabase/migrations` e os seeds `harmony_workspace.sql` e `harmony_templates.sql`, nessa ordem.
2. Na pasta `app`:

   ```bash
   HUB_CARGA_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres npx vitest run src/test/carga.test.ts --reporter=verbose
   ```

   A tabela com p50, p95 e máximo de cada cenário sai no fim. Sem a variável, o teste fica de fora, como no CI.

## Logs

O Hub escreve uma linha JSON por evento (`pino`), com `request_id`, sem dado pessoal e sem segredo: o erro do banco vai sem o `detail` (onde o Postgres põe os valores) e e-mail, chave e token viram marcadores. O `request_id` aparece também nas respostas de erro da API, para achar a linha certa.

```bash
ssh vps-harmony 'sudo docker logs --since 1h hub-app 2>&1 | tail -n 200'
```
