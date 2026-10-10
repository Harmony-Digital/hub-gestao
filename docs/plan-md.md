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

Uma seção `##` vira marco quando o título traz o código (`## M3 — ...`, mesmo sem itens) ou quando tem pelo menos um item com caixa ou um GATE. Seções sem caixas (regras, "Onde estamos", "Registro de Execução") são texto livre.

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

## Sincronização (pull e push)

Pelo MCP (`hub_sync_plan`) ou pela REST (`POST /api/v1/sync/plan`), sempre com o arquivo inteiro em `markdown` e `direction` `pull` ou `push`. A resposta traz o `markdown` para gravar no repositório, o resumo e os conflitos; toda execução fica registrada em `plan_sync_runs`. O Hub é a fonte de verdade: nos conflitos, ele vence.

**Pull** (o Hub vai para o arquivo):

- a caixa de cada tarefa com código fica igual ao Hub;
- os critérios de GATE ficam marcados se o marco foi aceito no Hub, ou se o critério está cumprido lá;
- as tarefas que só existem no Hub entram no lugar certo: na frente do arquivo com o mesmo nome, numa frente nova dentro do marco (antes do GATE), num marco novo (depois do último marco, ou antes do registro de execução) ou na seção "Sem marco";
- nada mais muda no arquivo.

**Push** (o que mudou no arquivo vem para o Hub):

- item sem código vira tarefa (origem `plan_md`) e ganha o código no arquivo devolvido; subitem vira subtarefa; frente nova dentro de um marco que existe é criada. Se já existe no Hub uma tarefa com o mesmo título, na mesma frente (ou sob a mesma tarefa-pai), que o arquivo não cita, o item é **ligado** a ela em vez de virar outra: é o caso de um push anterior cujo arquivo não voltou ao repositório (a GitHub Action não regrava o plano);
- caixa marcada conclui a tarefa com a evidência escrita no item (`— evidência: ...`) ou, se o push trouxer `commit_sha`, com "plan.md marcado no commit ...". Sem nenhuma das duas, a tarefa não é concluída: vira conflito e comentário na tarefa (uma vez só);
- item riscado não vira tarefa;
- **marco novo não é criado** (marco é decisão de pessoa): o conflito pede para criar pela tela e sincronizar de novo, e os itens dele ficam de fora;
- **GATE marcado no arquivo é ignorado** e gera alerta: o aceite do marco é do Fábio, nas Aprovações;
- código desconhecido (de outro projeto, arquivado ou inexistente) e código repetido viram conflito.

Com a versão anterior do arquivo (`base_markdown`, por exemplo a do commit anterior), o push também sabe o que o autor do arquivo quis mudar:

- desmarcar reabre a tarefa;
- renomear o item renomeia a tarefa (se ninguém mudou o título no Hub);
- tirar o item do arquivo **arquiva** a tarefa (nunca apaga).

Sem a versão anterior, essas três mudanças não são aplicadas: a caixa desmarcada de uma tarefa concluída no Hub é conflito, e o pull devolve o arquivo com o estado do Hub.

Cada item é aplicado à parte: o que o Hub recusar (falta de escopo da chave, título inválido) vira conflito do tipo `refused`, sem desfazer o resto.

## Importação (pela tela, por pessoa)

Para trazer um `plan.md` inteiro para um projeto, inclusive os marcos, há a tela **Importar o plan.md** (Editar projeto → Importar o plan.md), só para o dono do workspace e a administração: marco é decisão de pessoa, e agente recebe 403.

- Cole o conteúdo ou escolha o arquivo e clique em **Ver o que entra**: a importação roda inteira e é desfeita no fim (nada é gravado), mostrando os marcos novos, as frentes, as tarefas, as concluídas e os avisos. **Importar** só vale depois da prévia do mesmo texto.
- Os marcos que faltam entram com o código do arquivo (`## M3 — ...` vira o M3, se o código estiver livre) e na ordem do arquivo; marco sem código ganha o próximo livre. O status vem do arquivo: `✅` ou GATE todo marcado vira Entregue; algum item marcado, Em andamento; senão, Planejado. **Aceito, nunca**: o aceite continua sendo pedido (Pedir aceite) e decidido nas Aprovações.
- Os itens do GATE viram critérios de aceite do marco, marcados como estão no arquivo.
- Depois dos marcos, vale o push normal (frentes, tarefas, subtarefas). Item marcado sem evidência escrita entra concluído com a nota "Já estava concluída no plan.md quando ele foi importado".
- A tela devolve o arquivo com os códigos (botão para baixar). Grave no repositório no lugar do plano: os itens passam a levar os códigos e o pull e o push seguintes casam tudo pelo código. Importar de novo o arquivo devolvido não cria nada.
- A execução fica em `plan_sync_runs` com a direção `import`.

### Proposta do Planejador (PL-11)

Na mesma tela, o cartão **Propor com o Planejador** transforma um documento (PRD, brief ou transcrição) numa proposta neste formato: marcos numerados depois dos que o projeto já tem (`## M3 — ...`), frentes (`### ...`), tarefas e subtarefas, os critérios de aceite no GATE de cada marco (`### 🔒 GATE M3 (critérios de aceite)`), o prazo como linha "Prazo sugerido" e os textos para o cliente como citação de sugestão (texto livre: nada disso vira campo do Hub sozinho), e as premissas e dúvidas numa seção com `<!-- hub: ignorar -->`. **Levar para a importação** põe o texto no campo acima; dali em diante é a importação de sempre (Ver o que entra, depois Importar). Os títulos saem limpos para este leitor: uma linha, sem caixa, sem código de tarefa, sem risco e sem o travessão com espaços que abriria a nota.
