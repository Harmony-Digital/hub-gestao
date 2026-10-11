# Webhooks de saída do Hub

O Hub avisa outros sistemas quando algo acontece (PRD §8.6): o **Hermes**, que leva os avisos ao Telegram do Fábio, ou o **n8n**. Cada aviso é um `POST` com JSON, assinado com o segredo do webhook. Quem cadastra é só o dono, na Sala de Controle (`/agentes`), seção **Webhooks de saída**.

## Cadastro

1. Endereço público, com `https://` (o Hub recusa máquina local, rede interna e IP privado) e sem usuário ou senha no endereço: a autenticação é a assinatura.
2. Os eventos que o endereço recebe. Os sete do Telegram do Fábio vêm marcados: pedido de aprovação aberto, saúde de projeto mudou, orçamento de IA de um agente acabou e os quatro alertas de operação (recusas de acesso repetidas de um agente, job do relógio que falhou de vez, publicação que falhou e backup diário parado).
3. O Hub gera o **segredo** (`whsec_...`) e mostra **uma vez só**: copie e guarde no sistema que recebe. No banco, ele fica cifrado com `HUB_ENCRYPTION_KEY`; nunca vai para o histórico.
4. **Enviar teste** manda o evento `webhook.test` só para aquele webhook. A entrega sai em até cinco minutos (o relógio dos jobs roda de 5 em 5 minutos na VPS) e aparece na lista "Últimos avisos" com o resultado. O mesmo vale para os avisos de verdade: chegam com até cinco minutos de atraso.
5. **Trocar segredo**: o antigo para de valer na hora. **Pausar**: nada sai até reativar (os eventos do período não ficam guardados).

## O que chega

Cabeçalhos:

| Cabeçalho | Valor |
|---|---|
| `Content-Type` | `application/json` |
| `User-Agent` | `HubDeGestao-Webhook/1` |
| `Hub-Event` | o evento, como `approval.requested` |
| `Hub-Delivery` | id da entrega (o mesmo em cada nova tentativa: use para não processar duas vezes) |
| `Hub-Timestamp` | segundos desde 1970 (UTC), no momento do envio |
| `Hub-Signature` | `sha256=` + HMAC-SHA256, em hexadecimal, de `"<Hub-Timestamp>.<corpo>"` com o segredo |
| `X-Hub-Signature-256` | `sha256=` + HMAC-SHA256, em hexadecimal, só do corpo, com o mesmo segredo: o padrão do GitHub, para quem só sabe conferir esse formato (o receptor de webhooks do Hermes, o n8n). Prefira a `Hub-Signature`, que inclui o horário e impede reenvio de um aviso antigo |

Corpo:

```json
{
  "event": "approval.requested",
  "occurred_at": "2026-10-10T21:30:00.000Z",
  "request_id": "...",
  "actor": { "type": "agent", "id": "...", "name": "Kratos" },
  "data": { "id": "...", "type": "replan", "project_code": "CER", "title": "Mover o lançamento em uma semana" }
}
```

O `data` de cada evento:

| Evento | `data` |
|---|---|
| `approval.requested` | `id`, `type`, `project_code`, `title` |
| `approval.decided` | `id`, `type`, `status`, `project_code`, `effect` (o que a aprovação mudou: `milestone`, o código do marco criado; `replanned`, os marcos com a data de antes e a nova; `scope_changed`, os marcos com escopo novo; `client_message`, a mensagem publicada; `{ "applied": false }` quando nada mudou) |
| `project.health_changed` | `project_code`, `health` (`healthy`, `attention`, `at_risk`), `reasons` |
| `agent.budget_exceeded` | `agent` (`id`, `name`), `scope` (`agent`: o orçamento do agente; `workspace`: o teto do workspace), `budget_usd_month`, `spent_usd_month`, `detail`. No máximo um por dia por agente |
| `agent.denials_recurring` | `who` (o id do agente, ou `chave:<prefixo>`), `agent` (`id`, `name`; `null` se a chave não tiver agente), `key_prefix`, `count`, `by_status` (`401`, `403`, `423`), `last_reason`, `window_minutes` (60). Sai quando a mesma chave tem 5 ou mais recusas de acesso numa hora (conferido a cada 15 minutos); no máximo um por dia por agente |
| `system.job_failed` | `job_id`, `type`, `label` (o nome do job em PT-BR), `attempts`, `error` (o começo do erro, sem e-mail nem chave). Sai uma vez, quando um job do relógio esgota as tentativas |
| `system.deploy_failed` | `sha` (o commit) e `run_url` (a execução no GitHub Actions). Sai quando a publicação na VPS falha (a versão anterior continua no ar), uma vez por commit; precisa do `HUB_ALERT_SECRET` (`docs/operacao.md`) |
| `system.backup_stale` | `kind` (`local`: o dump diário na VPS; `offsite`: a cópia no Google Drive), `label`, `last_at` (o último aviso de backup que deu certo) e `hours`. Sai quando um backup que já deu sinal fica mais de 30 horas sem dar, uma vez por dia por tipo |
| `task.created` / `task.updated` / `task.completed` / `task.blocked` | `code`, `project_code` e os campos da mudança |
| `workstream.updated`, `milestone.status_changed`, `report.published` | o item e o projeto |
| `client.commented` | `project_code`, `author` (o nome do contato) e `excerpt` (o começo da mensagem, até 140 caracteres). Sai quando o contato escreve no portal ("Conversa com a equipe"); bom para o Telegram, pelo Hermes |
| `client.receipt_confirmed` | `project_code`, `milestone` (o código, como M2), `title` (o título para o cliente) e `author` (o nome do contato). Sai quando o contato decisor confirma no portal que recebeu uma entrega (opção do projeto; não é o aceite, que é do dono) |
| `webhook.test` | `message` (só pelo botão Enviar teste) |

## Conferir a assinatura

Recuse o aviso se a assinatura não bater ou se o `Hub-Timestamp` tiver mais de 5 minutos. Compare em tempo constante.

Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function avisoDoHubValido(segredo, cabecalhos, corpo) {
  const ts = cabecalhos["hub-timestamp"];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const esperado = "sha256=" + createHmac("sha256", segredo).update(`${ts}.${corpo}`).digest("hex");
  const recebido = cabecalhos["hub-signature"] ?? "";
  return esperado.length === recebido.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}
```

Python:

```python
import hashlib, hmac, time

def aviso_do_hub_valido(segredo: str, cabecalhos: dict, corpo: bytes) -> bool:
    ts = cabecalhos.get("Hub-Timestamp", "0")
    if abs(time.time() - int(ts)) > 300:
        return False
    esperado = "sha256=" + hmac.new(segredo.encode(), f"{ts}.".encode() + corpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, cabecalhos.get("Hub-Signature", ""))
```

Use o corpo exatamente como chegou (os bytes), antes de qualquer conversão.

## Entrega e novas tentativas

- Resposta 2xx em até 10 segundos: entregue.
- Outra resposta ou falha de rede: nova tentativa com espera crescente (1, 2, 4, 8... minutos), até 8 tentativas. A lista "Últimos avisos" mostra o erro.
- Sem `HUB_ENCRYPTION_KEY` no servidor, as entregas ficam esperando (o segredo não pode ser lido).

## Horário de silêncio (23h às 8h)

Cada webhook tem a opção "Silêncio das 23h às 8h", ligada por padrão no cadastro e trocada pelo botão "Silêncio à noite" na Sala de Controle (só o dono). Com ela ligada, o aviso que acontece das 23h às 8h, no fuso do workspace, fica na fila e sai às 8h; o corpo leva o `occurred_at` de quando aconteceu. Os alertas de operação (`system.job_failed`, `system.deploy_failed` e `system.backup_stale`) saem na hora, mesmo à noite. O aviso de teste também sai na hora. Regra em `emitEvent` (`app/src/modules/events.ts`), com a migração 0024.

## Hermes → Telegram (passo do Fábio)

O Hermes tem receptor de webhooks próprio, que, pela documentação dele (skill `hermes-agent`, no segundo cérebro), confere a assinatura no padrão do GitHub (`X-Hub-Signature-256`, que o Hub manda) e entrega a resposta do agente no Telegram. A versão instalada na VPS ainda não foi conferida por dentro do contêiner: se a assinatura não bater no teste, o passo seguinte é ver no Hermes qual cabeçalho ele espera.

1. No Hub, Sala de Controle → Webhooks de saída: cadastre o endereço público do Hermes (o passo 3 diz qual) com os sete eventos marcados, e copie o segredo.
2. No Hermes (dentro do contêiner, onde roda o `hermes gateway`), ligue os webhooks se ainda não estiverem (`hermes webhook list` diz; `hermes gateway setup` liga) e crie a assinatura com o segredo do Hub:

   ```bash
   hermes webhook subscribe hub-gestao \
     --secret "<segredo do Hub>" \
     --skills "vigia-de-prazos,gestor-de-projetos" \
     --deliver telegram --deliver-chat-id "<chat do Fábio>" \
     --prompt "Aviso do Hub de Gestão ({event}): {data}. Explique em uma frase e diga se pede decisão, com o link https://hub.harmonydigital.com.br/"
   ```

3. O endereço do Hermes é `/webhooks/hub-gestao` no servidor de webhooks dele (porta 8644, dentro da VPS). Para o Hub alcançar, ele precisa de um endereço público com https (uma rota no Traefik): mudança de infraestrutura, só com a ordem do Fábio. Volte ao passo 1 com esse endereço.
4. **Enviar teste** no Hub e confira "entregue" na lista e a mensagem no Telegram.

O segredo fica só no Hub (cifrado) e no Hermes: nunca no código, no chat ou no segundo cérebro (que vai para o GitHub).
