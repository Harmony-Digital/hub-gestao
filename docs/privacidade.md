# Privacidade e LGPD no Hub

O que o Hub de Gestão guarda de pessoas, por quê, onde, por quanto tempo, e como atender os pedidos dos titulares. A Harmony Digital é a controladora dos dados que o Hub trata; quem decide e responde por ela é o Fábio. As bases legais abaixo são a leitura do projeto e devem ser confirmadas com orientação jurídica.

## Quem e o quê

| Pessoas | Dados | Para quê | Base legal indicada (LGPD art. 7) |
|---|---|---|---|
| Equipe da Harmony | nome, e-mail, papel no workspace, login (Supabase Auth) e o que cada um fez (histórico) | operar o Hub, saber quem decidiu o quê | execução de contrato (trabalho) e legítimo interesse (auditoria e segurança) |
| Contatos dos clientes | nome, e-mail, papel no portal, aceite do uso dos dados, acessos ao portal (quando entrou e o último uso), mensagens no canal com a equipe, confirmações de entrega | acompanhar o projeto pelo portal e conversar com a equipe | execução do contrato com o cliente; o aceite no primeiro acesso registra a ciência do uso dos dados |
| Pessoas citadas em projetos de clientes | o que a equipe ou um agente escrever em tarefas, comentários e arquivos | executar o projeto contratado | execução de contrato |

O Hub não pede dado sensível (saúde, religião, biometria e outros do art. 5, II). **Orientação para a equipe e os agentes:** não pôr dado sensível nem dado pessoal desnecessário em tarefa, comentário ou arquivo. Um projeto de clínica, por exemplo, fala de fluxos e telas, nunca de pacientes.

Os logs técnicos do servidor não guardam dado pessoal: guardam ids e o `request_id`; e-mail, chave e token viram marcadores (`docs/seguranca.md`).

## Onde ficam e com quem são compartilhados

| Onde | O quê |
|---|---|
| Banco do Hub (Supabase próprio da Harmony, na VPS da Hostinger no Brasil; o endereço IP fica em São Paulo) | tudo o que está acima |
| Backups | dump diário na própria VPS (14 dias); backup semanal da VPS inteira pela Hostinger, em Campinas (Brasil); depois de o Fábio ligar, cópia diária no Google Drive da Harmony (30 dias), cifrada antes de sair da VPS: o Google guarda só o arquivo cifrado, sem a senha (os servidores do Google podem estar fora do Brasil; a cifra entra na revisão jurídica abaixo) |
| Provedores de IA (Anthropic, OpenAI ou xAI, conforme o modelo de cada agente), só quando um agente interno com IA está ligado | o texto do pedido: trechos de projeto, como o documento enviado ao Planejador ou o texto para o cliente que o Redator reescreve. São operadores fora do Brasil (transferência internacional, LGPD art. 33): usar os planos que não treinam modelo com os dados e não mandar dado pessoal desnecessário |
| Telegram, pelo Hermes, quando os avisos estiverem ligados | os eventos marcados no webhook: título de pedido, código de projeto e, no aviso de mensagem do cliente, o nome do contato e o começo da mensagem |
| Resend (e-mail), se ligado | e-mail e nome de quem recebe o link de acesso |
| GitHub | só o código do Hub: nenhum dado de cliente ou de contato, e o repositório está público até o fim da construção |

## Por quanto tempo

Os prazos da limpeza diária têm um padrão e uma faixa; o dono muda em **Configurações → Retenção dos registros** (PRD §12), e o novo prazo vale a partir da próxima limpeza.

| Registro | Prazo | Como sai |
|---|---|---|
| Recusas de acesso dos agentes | 90 dias (de 30 a 365) | limpeza diária automática (`apply_retention`, migrações 0021 e 0027) |
| Entregas de webhook já resolvidas | 30 dias (de 7 a 365) | limpeza diária |
| Jobs do relógio | concluídos: 30 dias (de 7 a 365); com falha: 90 dias (de 30 a 365) | limpeza diária |
| Avisos da caixa de entrada já lidos | 180 dias (de 30 a 730) | limpeza diária |
| Sessões e links do portal encerrados, vencidos ou usados | 90 dias (de 30 a 365) | limpeza diária |
| Chamadas de IA dos agentes (custo e modelo de cada uma) | 365 dias, os 12 meses do PRD (de 90 a 1095) | limpeza diária |
| Chaves de repetição (idempotência) | até vencerem | limpeza de hora em hora |
| Dump diário do banco | 14 dias | o próprio backup apaga |
| Cópia cifrada do dump no Google Drive | 30 dias | a própria cópia apaga as mais antigas |
| Cadastro de contato, mensagens e projetos | enquanto durar a relação com o cliente | exclusão pelo dono (abaixo), a pedido do titular ou no fim do contrato |
| Histórico (`activity_log`) | enquanto o workspace existir | não sai: é a trilha de auditoria, só de inserção, e guarda quem fez o quê. Alguns registros de acesso ao portal levam o nome do contato. Retenção por legítimo interesse e para o exercício regular de direitos (LGPD art. 7, VI e IX), a confirmar com orientação jurídica |
| Logs do contêiner na VPS | 5 arquivos de 10 MB (o mais antigo sai quando o quinto enche) | o Docker apaga (`logging` no `deploy/vps/docker-compose.yml`; aplicado na VPS em 2026-10-11 com `deploy/vps/hub-apply-compose.sh`) |

## Pedidos dos titulares (LGPD art. 18)

Responder em até 15 dias contados do pedido (art. 19, II), por escrito. Quem atende é o dono, em Clientes → o cliente → Contatos e portal:

- **Confirmação e acesso, portabilidade:** "Exportar os dados de <cliente> (JSON)". O arquivo traz o cliente; os contatos, com os acessos ao portal (sem os segredos), as mensagens e as ações no portal; e os projetos com as entregas, as frentes e os arquivos entregues. Tarefas e textos internos ficam de fora. Entregar ao titular só a parte dele.
- **Eliminação** (ou revogação do aceite): "Excluir os dados pessoais", na linha do contato, com confirmação. Saem o nome e o e-mail (trocados por "Contato removido" e um endereço inválido), o acesso, as sessões e os links. As mensagens dele no canal viram um aviso de mensagem removida. O nome sai dos avisos da equipe, das entregas de webhook e das confirmações de entrega. O perfil dele também é apagado quando nenhum outro contato ativo usa o mesmo perfil. Não tem volta: exporte antes, se precisar. O histórico registra a exclusão, sem o nome.
- **Correção:** hoje o dono corrige excluindo e cadastrando de novo (falta a edição do cadastro do contato).
- **Informação sobre o compartilhamento:** a tabela "Onde ficam e com quem são compartilhados", acima.

Pedido sobre alguém da equipe: o Fábio atende pelo Supabase (login) e pelo cadastro do perfil.

## Segurança e incidentes

As medidas técnicas estão em `docs/seguranca.md`; o que fazer num vazamento está em `docs/operacao.md` (Incidente de vazamento de dados), inclusive a comunicação à ANPD e aos titulares em até 3 dias úteis (Resolução CD/ANPD nº 15/2024).
