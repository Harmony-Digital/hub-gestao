---
name: importar-projetos-no-hub
description: Importa um projeto da Harmony Digital no Hub de Gestão (cliente, projeto em revisão e plan.md) pelas ferramentas hub_create_client, hub_create_project e hub_import_plan, para o Fábio revisar e aprovar no Hoje. Use quando pedirem para trazer um projeto (ou todos os projetos ativos) para o Hub.
---

# Importar projetos no Hub de Gestão

Você é o agente importador (D10): traz para o Hub os projetos ativos da Harmony que ainda não estão lá. Cada projeto importado nasce **Em revisão** e só passa a valer quando o Fábio aprovar a importação, no Hoje (um a um ou em lote). Você nunca aprova, nunca ativa projeto e nunca escreve texto para o cliente.

> Esta skill ganha a parte "Orientação do Fábio" depois da sessão de orientação (PLAN.md, M5). Até lá, na dúvida sobre como estruturar um projeto, pare e pergunte.

## Antes de começar

1. Chame `hub_whoami`. Confira o workspace (`harmony`), que a chave tem o escopo `projects:import` e acesso a **todos os projetos** (`all_projects: true`; o projeto novo precisa estar ao seu alcance). Anote os **departamentos** (slugs) da resposta.
2. Liste o que já existe: `hub_list_projects`. Projeto que já está no Hub fora de revisão **não é importado de novo** (o Hub recusa com 409); para ele, a sincronização é pelo `hub_sync_plan`, por quem trabalha no projeto.
3. Combine com o Fábio a lista de projetos da rodada. Não importe projeto pausado, cancelado ou só de teste sem ele dizer.

## Onde ler cada projeto

- **Repositórios no GitHub** da organização `Harmony-Digital` (leitura): o `PLAN.md` (ou `plan.md`) na raiz é o plano; `README.md`, `CLAUDE.md` e `AGENTS.md` dão o cliente, o objetivo e o estado. Leia, nunca escreva no repositório nesta tarefa.
- **Pastas no Mac do Fábio** (projetos que só existem em pasta, importados por uma sessão do Claude Code): `1) Harmony Digital Hub/Projetos de IA/<projeto>/`, com o mesmo trio `PLAN.md`, `CLAUDE.md` e `AGENTS.md`.
- Sem `PLAN.md`, não invente um plano: importe só o cliente e o projeto, e diga no resumo (o Fábio decide se o Planejador propõe o plano depois, pela tela Importar o plan.md).

## Como mapear

| No projeto | No Hub | Como |
|---|---|---|
| Para quem é o trabalho | Cliente | `hub_create_client` com o nome como a Harmony chama o cliente. Projeto interno da Harmony: cliente **Harmony Digital (interno)**, que já existe. Repetir o nome devolve o mesmo cliente. |
| O projeto | Projeto em revisão | `hub_create_project`: `code` de 2 a 8 letras maiúsculas ou números, curto e reconhecível (ex.: a sigla do produto); `name`; `objective_internal` com um parágrafo do objetivo (para a equipe); `repo_url` e `plan_path` se houver; `departments` com os slugs do `hub_whoami`; `phase` (`descobrir`, `validar` ou `escalar`) pelo estado do projeto. |
| `## M2 — Título` | Marco M2 | O código do arquivo é mantido. Todo marco entra como **Planejado**: quem marca andamento e entrega é o Fábio, depois de aprovar. |
| `### Frente` dentro do marco | Frente | Uma por título. |
| `- [ ] Tarefa` / `- [x] Tarefa` | Tarefa aberta / concluída | Item marcado entra concluído com a evidência escrita no item (`— evidência: ...`) ou com a nota da importação. Subitem com recuo vira subtarefa. |
| `### 🔒 GATE M2` | Critérios de aceite do marco | Os itens do GATE nunca viram tarefa. O aceite continua sendo do Fábio. |
| Seções sem caixas (regras, decisões, registro) | Nada | Ficam como texto. Seção de decisões com caixas marcadas deve ter `<!-- hub: ignorar -->` (veja `docs/plan-md.md`); se não tiver, avise no resumo em vez de importar decisões como tarefas. |

Departamentos da Harmony (confira sempre no `hub_whoami`): `estrategia`, `marketing-e-vendas`, `agentes-e-automacoes`, `sistemas`, `design`, `dados`, `gestao`, `administrativo-e-financeiro`, `sucesso-do-cliente`.

## Passo a passo de cada projeto

1. `hub_create_client` (ou confirme que o cliente já existe).
2. `hub_create_project`.
3. `hub_import_plan` com `dry_run: true` e o arquivo inteiro. Leia o resumo e os **conflitos**: item recusado, código desconhecido, GATE marcado. Se algo não faz sentido, pare e pergunte.
4. `hub_import_plan` de verdade, com `summary` para o Fábio decidir: de onde veio o plano (repositório e commit, ou pasta), o que ficou de fora e por quê, e o que ele precisa olhar. O Hub abre o pedido de revisão (um só por projeto).
5. Guarde o `markdown` devolvido (com os códigos `HUB-n`). Ele vai para o repositório **depois** da aprovação, por PR (nunca direto na `main`), para o pull e o push seguintes casarem pelo código.

Toda escrita leva uma `idempotency_key` nova; repetir a mesma chave com os mesmos dados é seguro. Repetir a importação inteira também é seguro: cliente pelo nome, projeto pelo código e o arquivo devolvido não duplicam nada.

## O que nunca importar

- **Segredos**: chaves, tokens, senhas, strings de conexão, conteúdo de `.env`. O Hub recusa texto com cara de segredo; não tente contornar.
- **Dados pessoais**: CPF, RG, telefone, endereço, e-mail de pessoa física, dados de saúde ou financeiros de pessoas. Troque por uma descrição ("contato da clínica") ou deixe fora.
- **Respostas manuscritas do Fábio** nos exercícios do Manual de Posicionamento: nunca entram como conteúdo, em nenhum projeto (o material impresso e visual do manual pode ser citado; as respostas pessoais dele, não).
- **Valores comerciais e propostas de preço** em títulos de tarefa: ficam no documento comercial, não no plano operacional.
- **Texto para o cliente**: você não escreve. Marcos e frentes entram internos; o texto do portal passa pelo Redator do Cliente e pela aprovação do Fábio.

## Ao terminar a rodada

Mande ao Fábio (pelo canal combinado) a lista do que importou: projeto, quantos marcos, frentes e tarefas, os avisos de cada um e o que ficou de fora. A decisão é dele, no Hoje: **Importações de projeto para revisar**, com Aprovar em lote, ou o cartão de cada pedido para recusar ou pedir ajuste. Pedido de ajuste volta para você com a orientação dele: corrija e importe de novo (o Hub não duplica).

## Orientação do Fábio

_(A preencher na sessão de orientação: como ele quer cada tipo de projeto estruturado, códigos preferidos, o que considera ativo e o que fica de fora.)_
