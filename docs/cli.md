# CLI `hub`

A CLI `hub` liga o repositório de um projeto ao Hub de Gestão: traz e devolve o `plan.md`, começa e conclui tarefas e mostra o que está com o agente no dia. Ela fala com a API do Hub (`/api/v1`) com a chave do agente. O código fica em `packages/cli/hub.mjs`: um arquivo só, sem dependências, para Node 22 ou mais novo.

## Instalar

No clone do `hub-gestao`:

```bash
npm install -g ./packages/cli
```

Isso cria o comando `hub`. Sem instalar, dá para rodar `node packages/cli/hub.mjs` com os mesmos argumentos.

## Chave e endereço

- **Chave**: a variável `HUB_API_KEY`, com a chave do agente criada pelo Fábio na tela Agentes. A chave nunca vai para o `.hub.json`, para o repositório, para o chat ou para o log. Escopos que o fluxo completo usa: `sync:plan`, `tasks:read`, `tasks:write` e `tasks:complete`. Frente nova pelo push pede `workstreams:write`; o aviso de conclusão sem evidência vira comentário com `comments:write`.
- **Endereço**: `HUB_URL`, ou o campo `url` do `.hub.json`, ou o padrão `https://hub.harmonydigital.com.br`.

## Comandos

| Comando | O que faz |
|---|---|
| `hub init --project VIT [--plan PLAN.md] [--url ...]` | Cria o `.hub.json` na raiz do repositório e põe `.hub/` no `.gitignore` |
| `hub plan pull` | Traz o `plan.md` atualizado do Hub (caixas, critérios do GATE e as tarefas que faltam) |
| `hub plan push [--commit <sha>] [--base <arquivo> \| --base-ref <ref>] [--estrito]` | Devolve ao Hub o que mudou no `plan.md` e regrava o arquivo com os códigos novos |
| `hub task start HUB-12` | Começa a tarefa |
| `hub task done HUB-12 --evidence "..."` | Conclui com a evidência (SHA, URL, arquivo ou teste) |
| `hub task new "Título" [--under HUB-12] [--frente <id>]` | Cria tarefa no projeto do `.hub.json` (subtarefa com `--under`) |
| `hub today` | O que está com o agente e o que está esperando por ele |

O `.hub.json` é procurado na pasta atual e nas de cima. As regras do formato do `plan.md` e da sincronização (o que o pull e o push fazem, quem vence, GATE, marcos novos) estão em `docs/plan-md.md`.

## Versão anterior do plano

Depois de cada `plan pull` ou `plan push`, a CLI guarda o arquivo sincronizado em `.hub/plan.base.md`, fora do git. No push seguinte, ela manda essa versão como `base_markdown`; é assim que o Hub sabe o que o autor do arquivo quis mudar: desmarcar reabre, renomear renomeia e tirar o item arquiva a tarefa. Sem a versão anterior, o Hub vence e devolve o estado dele.

Em lugar dela, dá para usar outra versão: `--base <arquivo>` ou `--base-ref <ref do git>` (por exemplo, `--base-ref HEAD~1` numa Action, com o arquivo do commit anterior).

## Ciclo de uma sessão de agente

```bash
hub plan pull                         # início: plano em dia
hub today                             # a fila
hub task start HUB-12
# ... trabalho real ...
hub task done HUB-12 --evidence "PR #45, testes verdes"
hub plan push --commit "$(git rev-parse HEAD)"   # fim: estado ao Hub e arquivo regravado
git add PLAN.md && git commit -m "Atualiza o plano"
```

## Saída e conflitos

Cada sincronização mostra o resumo (tarefas criadas, concluídas, reabertas, renomeadas, arquivadas, frentes novas, o que veio do Hub para o arquivo) e os conflitos, com a linha do arquivo. Conflito não é erro: a CLI sai com 0. Com `--estrito`, ela sai com 1 quando houver conflito (útil em CI). Recusa do Hub (chave sem escopo, projeto arquivado, código inválido) sai com 1 e a mensagem do Hub.
