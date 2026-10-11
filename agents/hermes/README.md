# Kratos (Hermes) no Hub de Gestão

Na fase 1 (decisão D6), o **Kratos**, agente pessoal do Fábio que roda no Hermes da VPS, assume os papéis de gestão do Hub como skills, com uma chave só, e é o importador dos projetos (D10). Esta pasta guarda a **cópia de referência** das skills; a versão que o Kratos usa fica no segundo cérebro do Fábio (`workspace-backup/skills/gestao-hub/`). Mudou uma, mude a outra no mesmo dia. Os exemplos desta cópia usam códigos de projeto fictícios (o repositório do Hub está público até o fim da construção); a cópia do segundo cérebro pode manter os exemplos reais.

> O `SOUL.md` do Kratos não muda sem a aprovação do Fábio. As skills dizem como operar o Hub; quem ele é continua no `SOUL.md` dele.

## Skills

| Skill | Papel (`papel` nas escritas) | Quando |
|---|---|---|
| `skills/gestao-hub/gestor-de-projetos` | GP-01 | resumo executivo diário, saúde mudou, marco mudou, perguntas do Fábio |
| `skills/gestao-hub/coordenador-tatico` | CT-02 | digest das 8h, marco aprovado, bloqueio, frente mudou |
| `skills/gestao-hub/relator-de-status` | RL-03 | status interno de segunda, entrega de marco, pedido do Fábio |
| `skills/gestao-hub/guardiao-da-qualidade` | QA-04 | tarefa concluída, verificação noturna, conflitos do `plan.md` |
| `skills/gestao-hub/vigia-de-prazos` | VP-05 | saúde de projeto mudou |
| `skills/gestao-hub/controlador-de-tempo` | TO-15 | desvios de tempo e custo da semana, pedido do Fábio |
| `skills/gestao-hub/auditor-de-acesso` | AC-14 | auditoria de acesso e segurança da semana, pedido do Fábio |
| `../skills/importar-projetos-no-hub` | KR-00 | importação dos projetos (D10), com a orientação do Fábio |

## Chave e papéis

Uma chave de agente para o Kratos, criada pelo Fábio na Sala de Controle (`/agentes`), com:

- **escopos**: `projects:read`, `milestones:read`, `tasks:read`, `tasks:write`, `tasks:complete`, `workstreams:write`, `comments:write`, `approvals:request`, `reports:draft`, `sync:plan`, `agents:read` e `projects:import`;
- **projetos**: todos. A importação cria projeto novo, que precisa estar ao alcance da chave. Na tela, a opção "todos os projetos" dá o acesso amplo (`workspace:*`), que vale por todos os escopos acima: as ações de pessoa (decidir, aceitar marco, chaves) continuam recusadas para qualquer agente;
- **papéis do catálogo** no cadastro do agente (Editar → Papéis do catálogo): KR-00, GP-01, CT-02, RL-03, QA-04, VP-05, TO-15 e AC-14. O Hub recusa uma escrita com um `papel` que o agente não tem;
- nunca `approvals:decide`, `portal:*` ou `agents:keys`: decisão é do Fábio.

Toda escrita informa o `papel` e uma `idempotency_key` nova; o histórico guarda o papel, e a Sala de Controle mostra, por exemplo, "Kratos como Coordenador Tático".

## Rotina (horário de Brasília)

| Quando | Skill | O quê |
|---|---|---|
| Dias úteis, 7h30 em diante (depois do rollup) | gestor-de-projetos | resumo executivo |
| Dias úteis, 8h | coordenador-tatico | digest matinal (até 8h15) |
| Segunda, 9h | relator-de-status | status interno da semana |
| Segunda, 9h30 | controlador-de-tempo | desvios de tempo e custo da semana |
| Segunda, 10h | auditor-de-acesso | auditoria de acesso e segurança da semana |
| Todo dia, 23h | guardiao-da-qualidade | verificação noturna |
| Fim do dia útil, 18h | gestor-de-projetos | resumo executivo do dia |
| Por evento do Hub | todas | `project.health_changed`, `approval.requested`, `agent.budget_exceeded` e os alertas de operação (`agent.denials_recurring`, `system.job_failed`, `system.deploy_failed`) (webhooks, `docs/webhooks.md`) |

Horário de silêncio para avisos proativos: 23h às 8h. O mesmo alerta não se repete em menos de 24 horas sem mudança de estado.

## Conexão com o Hub

- MCP: `https://hub.harmonydigital.com.br/mcp` (Streamable HTTP, `Authorization: Bearer <chave>`), ou a REST em `/api/v1` com o mesmo cabeçalho. Primeira chamada de toda sessão: `hub_whoami`.
- Avisos do Hub para o Kratos e o Telegram: webhook de saída cadastrado na Sala de Controle, com a assinatura conferida pelo Hermes (`docs/webhooks.md`).
## Hermes na VPS (o que se sabe)

Lido em 2026-10-10, sem abrir configuração nem segredo:

- O Hermes roda **dentro de um contêiner** na VPS (supervisionado pelo s6): o `hermes gateway run` (canais, rotinas e webhooks) e o painel (`hermes dashboard`, porta 9119). O usuário de leitura do agente não tem acesso aos contêineres, então a versão instalada e a configuração atual ficam para o Fábio conferir: `hermes --version`, `hermes webhook list` e `hermes cron list`, dentro do contêiner.
- Pela documentação do próprio Hermes (skill `hermes-agent` 2.3.0, no segundo cérebro):
  - **MCP**: em `~/.hermes/config.yaml`, na chave `mcp_servers`, um servidor HTTP com `url: "https://hub.harmonydigital.com.br/mcp"` e `headers` com `Authorization: "Bearer <chave do Kratos>"`; reiniciar o Hermes descobre as ferramentas, que aparecem como `mcp_<nome>_<ferramenta>` (com o nome `hub`, `mcp_hub_hub_whoami`). A chave fica só nesse arquivo, dentro da VPS: nunca no segundo cérebro, que vai para o GitHub.
  - **Rotinas**: `hermes cron create "<agenda>"` (formato cron de 5 campos, como `0 8 * * 1-5`, ou frases como `every monday 9am`), com as skills da rotina, o modelo e a entrega (Telegram); `hermes cron list` mostra. Cada execução tem até 3 minutos.
  - **Webhooks**: `hermes webhook subscribe <nome> --secret ... --skills ... --deliver telegram`; o receptor confere a assinatura no padrão do GitHub, que o Hub também manda (`docs/webhooks.md`).

## O que é do Fábio

Criar a chave do Kratos e marcar os papéis dele; copiar as skills para o segundo cérebro e instalá-las no Kratos; ligar o MCP e as rotinas no Hermes; o ponto de entrada dos webhooks no Hermes e o webhook no Hub; aprovar qualquer mudança no `SOUL.md`.
