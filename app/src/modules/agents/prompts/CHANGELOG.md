# Prompts dos agentes internos

Histórico dos prompts que o Hub usa nas chamadas de IA (`src/lib/llm`). Regras:

- Cada prompt tem um código estável e uma versão, no arquivo dele nesta pasta, e entra na lista `PROMPTS` de `index.ts`.
- Mudou o texto das instruções: suba a versão no arquivo e acrescente uma linha no topo da seção do prompt, com a data, a impressão digital do texto novo (os 12 primeiros caracteres do SHA-256) e o motivo da mudança.
- O teste `prompts.test.ts` confere que a versão em uso está registrada aqui com a impressão digital do texto atual: texto mudado sem versão nova reprova o CI.
- O código e a versão vão no propósito de cada chamada registrada em `agent_runs` (por exemplo, `HUB/testar-conexao@1`).
- Prompt novo: arquivo novo, entrada em `PROMPTS` e seção nova aqui. Nada de segredo, dado pessoal ou nome de cliente no texto de um prompt: o que muda a cada pedido vai na mensagem, montada no servidor.

## HUB/testar-conexao

- v1 · 2026-10-10 · `68173af2cf95` · Chamada mínima do botão Testar conexão, na Sala de Controle.

## CO-10/interpretar

- v1 · 2026-10-10 · `43400f56ca4f` · Primeira versão do Concierge: converte o pedido (falado ou digitado) numa ação só (criar ou mudar tarefa, comentar, apontar um pedido de aprovação, pergunta respondida com dados do Hub, abrir uma tela), com as regras de datas a partir de hoje e sem inventar projeto, pessoa ou prazo.
