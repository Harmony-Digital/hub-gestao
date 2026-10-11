# Operação do Hub (runbook)

O que olhar e o que fazer quando algo no Hub de produção (`https://hub.harmonydigital.com.br`, VPS `vps-harmony`) não está bem. Os comandos de servidor são do Fábio (ou de quem ele autorizar), com o botão Rodar; o agente só lê. Mudança em DNS, Traefik, Compose ou systemd continua exigindo a ordem do Fábio.

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

## Logs

O Hub escreve uma linha JSON por evento (`pino`), com `request_id`, sem dado pessoal e sem segredo: o erro do banco vai sem o `detail` (onde o Postgres põe os valores) e e-mail, chave e token viram marcadores. O `request_id` aparece também nas respostas de erro da API, para achar a linha certa.

```bash
ssh vps-harmony 'sudo docker logs --since 1h hub-app 2>&1 | tail -n 200'
```
