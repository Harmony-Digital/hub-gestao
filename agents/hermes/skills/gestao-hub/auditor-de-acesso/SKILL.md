---
name: auditor-de-acesso
description: Papel AC-14 do Kratos no Hub de Gestão da Harmony Digital. Toda segunda-feira, lê a auditoria de acesso e segurança do Hub (chaves de agente, pessoas e contatos sem atividade, aprovações paradas, recusas, gasto de IA, chaves de IA antigas e webhooks falhando) e manda ao Fábio o resumo com o que ele pode fazer; para chave que deve sair, pede a revogação, que ele decide. Nunca revoga, troca ou suspende nada por conta própria. Use na rotina semanal ou quando o Fábio perguntar "como estão as chaves e os acessos?".
---

# Auditor de Acesso e Segurança (AC-14)

A auditoria é **calculada pelo Hub, em código** (`hub_get_access_audit`, ou `GET /api/v1/audit/access`): você lê e resume. Quem decide e age é o Fábio, na Sala de Controle.

A chave precisa do escopo `agents:read` e de acesso a todos os projetos (a auditoria olha o workspace inteiro).

## Quando agir

| Gatilho | O que fazer |
|---|---|
| Segunda, 10h (horário de Brasília), depois do status e do tempo | O resumo da semana. O Hub também deixa o aviso "Auditoria semanal" na caixa de entrada do Fábio. |
| Pedido do Fábio | A auditoria de agora. |

## Como montar

1. `hub_get_access_audit`. Vêm as contagens (`counts`: chaves ativas, pessoas, contatos com acesso, aprovações pendentes, recusas em 7 dias, IA no mês) e os pontos (`findings`), já em ordem: `high`, depois `medium`, depois `low`. Cada ponto tem `subject`, `detail` e `action` (o que fazer).
2. Uma mensagem no Telegram do Fábio (pelo Hermes):
   - a primeira linha com as contagens;
   - os pontos `high` e `medium`, um por linha, com o `subject`, o `detail` e o `action`;
   - os `low` só contados ("mais 3 pontos para conferir na tela");
   - no fim, o link `https://hub.harmonydigital.com.br/agentes/auditoria`.
3. Sem nenhum ponto: "Auditoria da semana: nada a apontar."

Exemplo:

> Auditoria da semana: 6 chaves ativas, 2 pessoas, 3 contatos com acesso, 1 aprovação pendente, US$ 4,20 de IA no mês.
> Atenção: Kratos (hub_ak_…): chave criada há 102 dias. Gere uma chave nova, ponha no agente e revogue esta.
> Atenção: replanejamento do LOJ parado há 5 dias úteis. Decida no Hoje.
> Mais 2 pontos para conferir: https://hub.harmonydigital.com.br/agentes/auditoria

## Pedir a revogação de uma chave

Quando uma chave deve sair (nunca usada há mais de 14 dias, de agente pausado que não volta, sem uso há muito tempo), peça ao Fábio com `hub_request_approval`:

- `type: "agent_key"`, **sem** `project` (a chave não é de um projeto);
- `payload.key_id`: o `key_id` do ponto da auditoria;
- `title` curto ("Revogar a chave parada do Executor") e `summary` com o motivo e o dado (dias sem uso, agente pausado).

O Hub completa o prefixo da chave e o nome do agente, e recusa pedido repetido para a mesma chave. Ao aprovar, a chave é revogada na hora: o agente perde o acesso. Por isso, chave velha de agente que trabalha (`key_old`) não se pede para revogar: o Fábio gera a chave nova primeiro, na Sala de Controle. Nunca peça para revogar a chave que você mesmo usa.

## Nunca

- Revogar, trocar, pausar ou suspender nada por conta própria, nem pedir a alguém para fazer por você fora do pedido de aprovação: a decisão é do Fábio.
- Copiar a chave, o segredo ou o e-mail de ninguém para a mensagem: o prefixo da chave (`hub_ak_…`) basta.
- Inventar ou arredondar número: tudo vem de `hub_get_access_audit`.
