# Formato do `plan.md` para a sincronização com o Hub

O Hub é a fonte de verdade; o `plan.md` de cada projeto é uma projeção sincronizada nos dois sentidos (PRD §5.5 e §8.5). Este documento descreve como o Hub lê o arquivo. A leitura fica em `app/src/modules/sync/plan-file.ts`.

## Regra de ouro: byte-neutro

O Hub nunca reescreve o arquivo inteiro. Ao sincronizar, ele só:

- troca a caixa de um item (`[ ]` ↔ `[x]`);
- acrescenta o código da tarefa no fim do item, entre parênteses: `(HUB-57)`.

Todo o resto (títulos, textos, tabelas, quebras de linha, inclusive `\r\n`, espaços no fim da linha) volta exatamente como estava.

## O que vira o quê

| No arquivo | No Hub |
|---|---|
| `# Título` (o primeiro) | nome do plano |
| `## M2 — Publicação inicial` | marco `M2`, título "Publicação inicial" |
| `## ✅ Preparação` | marco já concluído, sem código |
| `### Pipeline` (dentro de um marco) | frente do marco |
| `- [ ] Tarefa (HUB-57)` | tarefa `HUB-57` (aberta) |
| `- [x] Tarefa (HUB-57)` | tarefa `HUB-57` (concluída) |
| `  - [ ] Subitem (HUB-58)` (com recuo) | subtarefa de `HUB-57` (um nível só) |
| `### 🔒 GATE M2 (aprovação do Fábio)` | GATE do marco: os itens abaixo são critérios de aceite, nunca tarefas |
| `## Sem marco` e `### Tarefas sem frente` | frentes e tarefas sem marco (como na exportação do Hub) |

Uma seção `##` só vira marco se tiver pelo menos um item com caixa ou um GATE. Seções sem caixas (regras, "Onde estamos", "Registro de Execução") são texto livre.

## Itens

- O **código** é o último `(PREFIXO-n)` do item, com o prefixo do workspace (`HUB` na Harmony). Outras marcações entre parênteses, como `(GPT-5)` ou `(D1)`, ficam no texto.
- O **título** que vai para o Hub é o texto até o primeiro ` — ` (travessão com espaços), sem a marcação de negrito e de código, em uma linha e com até 300 caracteres (o que passar disso é cortado com `…`). Se o item começa com um trecho em negrito que termina em dois-pontos (`**Ligar áreas às análises:** resto`), o título é esse trecho.
- O que vem depois do título é a **nota**. Se a nota traz `evidência: …`, o texto depois de `evidência:` é a evidência de conclusão (até 2000 caracteres).
- Item **riscado** (`- [ ] ~~Perfil dedicado~~ — cancelado`) é marcado como cancelado no plano.
- Um item pode continuar nas **linhas de baixo**, com recuo maior que o do `-`; tudo entra no texto do item, e o código vai no fim da última linha.
- Itens dentro de **cercas de código** (` ``` ` ou `~~~`) são ignorados.

## Seção ignorada

Uma seção `##` com a linha abaixo fica inteira como texto livre, mesmo com caixas (útil para decisões registradas como lista marcada):

```md
## Decisões do Fábio

<!-- hub: ignorar -->

- [x] **D1** Domínio: …
```

A linha é um comentário HTML: não aparece quando o Markdown é exibido.
