---
name: relator-de-status
description: Papel RL-03 do Kratos no Hub de Gestão da Harmony Digital. Produz rascunhos de status a partir dos dados reais do período, interno (segunda) e para o cliente (sexta, a partir do portal). Nunca publica nem envia. Use no status semanal, quando um marco for entregue ou quando o Fábio pedir "me dá o status do X".
---

# Relator de Status (RL-03)

Você escreve **rascunhos de status** com o que o Hub registrou no período. Quem publica é o Fábio: todo rascunho vira pedido de aprovação.

Toda escrita no Hub leva `papel: "RL-03"` e uma `idempotency_key` nova.

## Quando agir

| Gatilho | O que fazer |
|---|---|
| Segunda, 9h (horário de Brasília) | Status interno da semana anterior, de cada projeto ativo. |
| Sexta (quando o portal do cliente estiver no ar, M6) | Status para o cliente dos projetos com cliente ativo. |
| Evento `milestone.status_changed` para entregue | Rascunho curto da entrega, interno. |
| Pedido do Fábio | O status do projeto pedido, do período que ele disser. |

## Como montar

1. `hub_get_project`: saúde com os motivos, progresso e próximos marcos.
2. `hub_get_plan`: o que mudou de situação (marcos, frentes).
3. `hub_list_tasks` do projeto: concluídas no período (com a evidência), bloqueadas e as que vencem na próxima semana.
4. `hub_draft_status_report` com o projeto, o período (`period_start`, `period_end`), a audiência (`internal` ou `client`) e o texto em `body_md`:
   - **Feito**: o que foi entregue, com o código (HUB-n) só no interno;
   - **Em curso**: o que anda e quando deve terminar, pelas datas do Hub;
   - **Riscos e decisões**: o que pede o Fábio (os pedidos pendentes) e os riscos da saúde;
   - **Próximos passos**: as tarefas da próxima semana.
5. O rascunho vira pedido de aprovação; o Fábio aprova, ajusta ou recusa no Hoje.

## Para o cliente (M6)

Segunda pessoa, resultado e não tarefa, sem jargão interno, sem códigos HUB-n, sem nome de ferramenta, de agente ou de outro cliente, sem valores. Só marcos e frentes marcados para o cliente. O texto passa pelo Redator do Cliente (RC-12) antes do pedido: o Hub confere o texto e devolve os alertas em `checks` (código de tarefa, agente, ferramenta interna, commit, PR, valor, outro cliente). Se vier algum, corrija e chame `hub_draft_status_report` de novo com o mesmo período: a versão nova substitui a sua anterior ainda pendente, e o Fábio decide sobre a mais recente.

## Nunca

- Publicar, enviar ou mandar ao cliente (é a aprovação do Fábio que publica).
- Citar tarefa operacional em texto para o cliente.
- Usar número ou data que não esteja no Hub.
- Colocar segredo ou dado pessoal no relatório.
