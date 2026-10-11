# n8n e o Hub (N8-17 · n8n Bridge)

O n8n da Harmony (`https://n8n.harmonydigital.com.br`, na VPS) cria tarefas no Hub a partir dos fluxos que já existem, como "lead qualificado vira tarefa em Marketing e Vendas" ou "chamado de cliente no WhatsApp vira tarefa em Sucesso do Cliente" (catálogo, `AGENTES.md`, N8-17). O n8n entra como um agente do tipo **Integração**, com chave própria e escopo mínimo: só cria tarefas, só nos projetos escolhidos. Tudo o que ele grava aparece no histórico e na Sala de Controle com o nome dele.

O fluxo pronto está em `agents/n8n/hub-nova-tarefa.json`. O teste automático `app/src/app/api/v1/n8n-workflow.test.ts` manda o pedido desse fluxo para a API de verdade, com uma chave igual à do passo 1: se a API mudar, o teste acusa antes de o fluxo quebrar.

## Ligar (passos do Fábio)

1. **Agente e chave, no Hub** (Sala de Controle, `/agentes`; só o dono):
   - Novo agente: nome `n8n Bridge`, tipo **Integração**, departamento Agentes e Automações, papel N8-17 (Papéis do catálogo).
   - Nova chave para ele: escopo `tasks:write` (e `comments:write` se algum fluxo for comentar) e, em projetos, **só os que os fluxos usam**. A chave aparece uma vez: copie.
2. **Credencial, no n8n**: Credentials → Add credential → **Header Auth**. Nome da credencial: `Hub de Gestão (N8-17)`. Em *Name*, `Authorization`; em *Value*, `Bearer ` seguido da chave (com o espaço). A chave fica só aí: nunca no fluxo, no chat ou no repositório.
3. **Fluxo, no n8n**: Workflows → Import from File → `agents/n8n/hub-nova-tarefa.json`. Abra o nó "Criar a tarefa no Hub" e escolha a credencial do passo 2 (o arquivo traz só o nome dela).
4. **Teste**: no nó "Exemplo", ponha um projeto que a chave alcança (o exemplo usa `HUB`) e clique em *Test workflow*. A tarefa "Teste do N8-17: tarefa criada pelo n8n" aparece na Lista do projeto e no feed da Sala de Controle, feita pelo n8n Bridge. Rodar de novo devolve a mesma tarefa, sem duplicar. Depois do teste, conclua ou arquive a tarefa.

Com o passo 4 feito, o item do `PLAN.md` (EX-09 e N8-17, M7) pode ser marcado com a evidência: o código da tarefa criada.

## Usar nos fluxos que já existem

Nos outros fluxos, acrescente um nó **Execute Workflow** ("Executar fluxo") que chama "Hub · nova tarefa (N8-17)" e mande um item com estes campos:

| Campo | Obrigatório | O que é |
|---|---|---|
| `projeto` | sim | Código do projeto, como `HUB` |
| `titulo` | sim | Título da tarefa, numa linha (até 300 caracteres) |
| `descricao` | não | Descrição em Markdown |
| `prioridade` | não | `urgent`, `high`, `normal` (padrão) ou `low` |
| `prazo` | não | Data no formato `AAAA-MM-DD` |
| `frente` | não | Id da frente (do departamento) dentro do projeto. Para descobrir, a chave precisa também de `projects:read`: `GET /api/v1/projects/<código>/workstreams` |
| `id_externo` | recomendado | O id do lead, do chamado ou da mensagem no sistema de origem. Vai para a tarefa (`external_ref`) e impede a tarefa repetida |

**Sem duplicar:** o fluxo manda o cabeçalho `Idempotency-Key` montado a partir do `id_externo` (`n8n-tarefa-<id>`). O mesmo id devolve a mesma tarefa; o mesmo id com outros dados é recusado (409), que é o Hub evitando a repetição. Sem `id_externo`, cada execução cria uma tarefa nova.

**Erros:** o Hub responde em português, com o que corrigir (`detail`). Os mais comuns: 400 (campo inválido, como prazo fora do formato; a resposta lista os campos em `errors`), 401 (chave errada ou revogada), 403 (escopo que falta ou projeto fora da chave) e 423 (agente pausado).

## Receber avisos do Hub no n8n (opcional)

O Hub também avisa o n8n quando algo acontece (tarefa criada, concluída ou bloqueada, pedido de aprovação, saúde do projeto), pelos **Webhooks de saída** da Sala de Controle (`docs/webhooks.md`):

1. No n8n, um fluxo novo com o nó **Webhook** (POST). Copie o endereço de produção dele.
2. No Hub, cadastre esse endereço em Webhooks de saída, escolha os eventos e guarde o segredo (aparece uma vez).
3. Confira a assinatura antes de agir: o Hub manda `X-Hub-Signature-256` (`sha256=` mais o HMAC-SHA256 do corpo com o segredo, o padrão do GitHub) e `Hub-Signature` (que inclui o horário). No n8n, um nó **Code** faz a conta com o módulo `crypto`, que precisa estar liberado no contêiner do n8n (`NODE_FUNCTION_ALLOW_BUILTIN=crypto`, configuração do n8n, passo do Fábio). O código de exemplo está em `docs/webhooks.md`, seção "Conferir a assinatura".

## Desligar

Revogue a chave do n8n Bridge na Sala de Controle (ou pause o agente): a partir daí o Hub recusa os pedidos do fluxo (401 ou 423), e a recusa aparece em "Recusas de acesso".
