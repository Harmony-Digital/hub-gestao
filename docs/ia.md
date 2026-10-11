# Ligar a IA dos agentes internos

Três recursos do Hub usam IA e ficam desligados (falha fechada) até existir um agente com chave e modelo:

| Recurso | Papel | Onde aparece |
|---|---|---|
| Concierge | CO-10 | `⌘K` → "Pedir ao Concierge" (texto ou microfone) |
| Planejador | PL-11 | Editar projeto → Importar o plan.md → "Propor com o Planejador" |
| Redator do Cliente | RC-12 | Janela da frente → "Pedir sugestão ao Redator"; reescrita dos textos para o cliente nos pedidos de aprovação |

Um só agente pode ter os três papéis. Tudo é feito pelo dono, na Sala de Controle (`/agentes`). A chave nunca passa pelo chat nem por outra pessoa.

## Passo a passo (uns 5 minutos)

1. **Chave de IA:** Sala de Controle → Chaves de IA → **Nova chave de IA**. Escolha o provedor e cole a chave (o campo esconde o valor; o Hub guarda cifrada e mostra só os 4 últimos caracteres).
2. **Agente:** **Cadastrar agente**, com o nome "Agente interno do Hub", departamento Agentes e Automações, um orçamento de IA por mês (ex.: US$ 10) e os papéis CO-10, PL-11 e RC-12.
3. **Modelo:** no agente, botão **Modelo de IA**:
   - o provedor e a chave do passo 1;
   - o modelo e os preços por milhão de tokens (tabela abaixo);
   - **Testar conexão**: a resposta diz o modelo e o custo do teste.
4. **Conferir**, num projeto de teste (Projetos → Novo projeto), sem tocar nos projetos oficiais. No `⌘K`, peça "criar tarefa Revisar o texto do site amanhã" com o projeto de teste aberto: a prévia aparece, e nada é gravado antes de Confirmar.

Sem o preço, o Hub recusa a chamada: ele precisa do preço para controlar o orçamento. O teto do mês para todos os agentes é o `LLM_MONTHLY_BUDGET_USD` do servidor.

## Modelos Claude (preços oficiais da Anthropic, lista de 2026-10-06)

| Modelo | ID para o campo "Modelo" | Entrada (US$ por milhão) | Saída (US$ por milhão) |
|---|---|---|---|
| Claude Opus 5.5 (padrão recomendado pela Anthropic) | `claude-opus-5-5` | 4,00 | 20,00 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 2,00 | 10,00 |
| Claude Haiku 5.5 (até 100 mil tokens de entrada) | `claude-haiku-5-5` | 0,10 | 0,50 |
| Claude Fable 5.1 (o mais capaz, mais caro) | `claude-fable-5-1` | 10,00 | 50,00 |

Os modelos 5.5 sempre pensam antes de responder, e o raciocínio conta como saída. O Hub soma uma folga fixa de raciocínio ao limite de cada chamada (`REASONING_HEADROOM`, em `app/src/lib/llm/index.ts`) para a resposta não sair cortada. O custo registrado é só o que foi gerado, e aparece na Sala de Controle ("IA neste mês") e por projeto no Painel. Escolher um modelo mais barato é decisão do Fábio: o Hub funciona com qualquer um dos quatro.

OpenAI e xAI também funcionam (mesmo caminho). Os preços devem ser conferidos na página de preços de cada provedor no dia da configuração.

## Quando algo falha

A janela do recurso mostra o motivo (sem modelo, sem chave, sem orçamento, sem preço, erro do provedor). Cada chamada fica registrada com o custo e o erro, sem a chave. Trocar ou revogar a chave: Sala de Controle → Chaves de IA, só o dono.
