# Webhook do GitHub

O Hub recebe os eventos `push` e `pull_request` de cada repositório da Harmony em `https://hub.harmonydigital.com.br/api/internal/webhooks/github` (PRD §8.7). O código fica em `app/src/modules/github/webhook.ts` e na rota `app/src/app/api/internal/webhooks/github/route.ts`.

## O que ele faz

- **Commit ou PR que cita `HUB-n`** (na mensagem do commit, no título ou na descrição do PR) vira comentário interno na tarefa, com o repositório, o ramo ou o número do PR, a primeira linha da mensagem e o link. Exemplo: `Commit a1b2c3d em Harmony-Digital/exemplo@main: Ajusta o fluxo (https://github.com/...)`.
- **`fecha HUB-n`** vira **proposta de conclusão**, mas só quando o commit chega no ramo principal do repositório ou quando o PR é mesclado. Também valem `fechar`, `conclui`, `resolve`, `closes`, `fixes` e `resolves`, com ou sem dois-pontos. A tarefa vai para o status de "Em revisão" do projeto e ganha um comentário com o commit ou o PR como evidência sugerida. **O webhook nunca conclui sozinho**: quem conclui é uma pessoa ou o Guardião da Qualidade, com a evidência.
- Tarefa já concluída, arquivada ou de código inexistente não muda.
- Reentregas do GitHub não repetem nada: o mesmo comentário não entra duas vezes na mesma tarefa.
- Tudo fica no histórico com o autor "Hub" e a origem `webhook`.

## Segurança

Cada evento é conferido pela assinatura `X-Hub-Signature-256` (HMAC-SHA256 do corpo com o segredo `GITHUB_WEBHOOK_SECRET`, de 32 caracteres ou mais). Sem o segredo configurado, o servidor recusa tudo; assinatura errada recebe 401. O evento `ping`, que o GitHub manda ao criar o webhook, responde 200.

## Instalar (Fábio, uma vez no servidor e uma vez por repositório)

1. **Segredo no servidor**: gerar um valor longo e aleatório (por exemplo, `openssl rand -hex 32`) e gravar como `GITHUB_WEBHOOK_SECRET` em `/opt/hub-gestao/shared/.env.production` na VPS. O contêiner lê o arquivo ao subir; a publicação seguinte (ou um reinício do `hub-app`) passa a usar o segredo. O valor nunca vai para chat, commit ou documento.
2. **Webhook em cada repositório**: no GitHub, Settings → Webhooks → Add webhook:
   - Payload URL: `https://hub.harmonydigital.com.br/api/internal/webhooks/github`
   - Content type: `application/json`
   - Secret: o mesmo valor do passo 1
   - Events: "Let me select individual events" → **Pushes** e **Pull requests**
   - Active: marcado
3. **Conferir**: na página do webhook, em "Recent Deliveries", o `ping` deve aparecer com resposta 200.

Para os agentes: escrever o código da tarefa na mensagem do commit (`Ajusta o fluxo (HUB-12)`) e, quando o commit entrega a tarefa, `fecha HUB-12`. A conclusão continua sendo feita com a evidência (`hub task done HUB-12 --evidence ...`).
