# Webhooks de saída do Hub

O Hub avisa outros sistemas quando algo acontece (PRD §8.6): o **Hermes**, que leva os avisos ao Telegram do Fábio, ou o **n8n**. Cada aviso é um `POST` com JSON, assinado com o segredo do webhook. Quem cadastra é só o dono, na Sala de Controle (`/agentes`), seção **Webhooks de saída**.

## Cadastro

1. Endereço público, com `https://` (o Hub recusa máquina local, rede interna e IP privado) e sem usuário ou senha no endereço: a autenticação é a assinatura.
2. Os eventos que o endereço recebe. Os três do Telegram do Fábio vêm marcados: pedido de aprovação aberto, saúde de projeto mudou e orçamento de IA de um agente acabou.
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
| `approval.decided` | `id`, `type`, `status`, `project_code` |
| `project.health_changed` | `project_code`, `health` (`healthy`, `attention`, `at_risk`), `reasons` |
| `agent.budget_exceeded` | `agent` (`id`, `name`), `scope` (`agent`: o orçamento do agente; `workspace`: o teto do workspace), `budget_usd_month`, `spent_usd_month`, `detail`. No máximo um por dia por agente |
| `task.created` / `task.updated` / `task.completed` / `task.blocked` | `code`, `project_code` e os campos da mudança |
| `workstream.updated`, `milestone.status_changed`, `report.published` | o item e o projeto |
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

## Hermes → Telegram (passo do Fábio)

1. No Hermes, um ponto de entrada HTTPS que receba o `POST`, confira a assinatura com o segredo (acima) e mande a mensagem para o Telegram do Fábio. Sugestão de texto: "Pedido esperando a sua decisão em CER: Mover o lançamento em uma semana", "A saúde de CER mudou para Atenção", "O Concierge parou de usar IA: o orçamento do mês acabou", sempre com o link do Hoje (`https://hub.harmonydigital.com.br/`).
2. No Hub, Sala de Controle → Webhooks de saída: o endereço do Hermes e os três eventos marcados. Copie o segredo para o cofre do Hermes (nunca no código nem no chat).
3. **Enviar teste** e confira "entregue" na lista e a mensagem no Telegram.
