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

- v2 · 2026-10-10 · `01a623a3544b` · O exemplo de pedido de aprovação citava um cliente real; trocado por um exemplo genérico ("aprova o relatório de status do site"). Mesmo comportamento.
- v1 · 2026-10-10 · `43400f56ca4f` · Primeira versão do Concierge: converte o pedido (falado ou digitado) numa ação só (criar ou mudar tarefa, comentar, apontar um pedido de aprovação, pergunta respondida com dados do Hub, abrir uma tela), com as regras de datas a partir de hoje e sem inventar projeto, pessoa ou prazo.

## PL-11/propor

- v1 · 2026-10-10 · `b14e3a051c7f` · Primeira versão do Planejador: do documento (PRD, brief, transcrição) para marcos com critérios de aceite, frentes por departamento e tarefas iniciais, com prazos só quando o documento sustenta, textos para o cliente em segunda pessoa e as premissas e dúvidas à parte.

## RC-12/redigir

- v2 · 2026-10-11 · `65d5ef6e0d70` · Passa a reescrever também a mensagem externa para o canal do cliente (TIPO mensagem, em `text`) e o título e a descrição para o cliente de um marco proposto (TIPO marco, em `title` e `description`), além do relatório e da frente.
- v1 · 2026-10-10 · `61f6ba1a2bea` · Primeira versão do Redator do Cliente: reescreve no tom Harmony (segunda pessoa, resultado, sem jargão) o relatório de status para o cliente ou o título e a descrição de uma frente que vai ao portal, mantendo fatos, datas e números e tirando o que a verificação em código achou.
