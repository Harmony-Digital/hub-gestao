# E-mail do Hub (Resend)

O Hub manda e-mail pelo Resend (PRD RF-33; D9), sempre com o clique de alguém:

- **convite do portal:** Clientes → o cliente → Contatos e portal → "Liberar acesso" ou "Gerar novo link" → **Enviar por e-mail**, só o dono. Vai a mensagem que ele revisou na tela, com o link de uso único;
- **convite da equipe** (RF-03): Configurações → Equipe → **Convite por e-mail**, só o dono, para outra pessoa ativa da equipe: diz por onde entrar (o endereço de entrada do Hub e, com o link de acesso ligado, como pedir o link). O Hub não cria conta de acesso;
- **e-mail de teste:** Configurações → E-mail do Hub → **Enviar um e-mail de teste para mim**, só o dono e só para o próprio endereço;
- **link pedido pelo contato** (RF-05): o contato que o dono já liberou pede um link novo na entrada do portal ("Receber um link novo") e recebe, no e-mail cadastrado, um link de uso único válido por 30 minutos. O clique é do próprio contato, e o e-mail só vai para ele (`docs/portal.md`, Acesso).

Até o servidor ter `RESEND_API_KEY` e `HUB_EMAIL_FROM`, o envio fica desligado: os botões aparecem desligados e dizem por quê, e o dono continua copiando o convite e mandando por onde preferir. O Hub nunca registra endereço, assunto nem corpo dos e-mails. O histórico guarda que o convite saiu, com o id do Resend, nunca o link.

## Ligar (Fábio, uma vez)

1. **Domínio no Resend.** Na conta do Resend da Harmony, em Domains → Add domain, cadastre `harmonydigital.com.br` (ou um subdomínio, por exemplo `mail.harmonydigital.com.br`), na região São Paulo (`sa-east-1`). O Resend mostra os registros de DNS: DKIM, SPF e, se quiser, DMARC.
2. **DNS.** Crie esses registros na zona `harmonydigital.com.br`, na Hostinger, e espere o Resend marcar o domínio como verificado. Mudança de DNS é sempre ordem do Fábio; se ele quiser, o agente cria os registros pela API da Hostinger depois do ok no chat.
3. **Chave.** No Resend, em API Keys → Create API key, escolha a permissão "Sending access", só para o domínio do passo 1. A chave aparece uma vez e vai direto para o passo 4, nunca para o chat.
4. **Servidor.** Na pasta do repositório, rode o comando abaixo:

   ```bash
   deploy/vps/hub-email-setup.sh
   ```

   O script pede a chave (o que se digita não aparece), o remetente (por exemplo `hub@harmonydigital.com.br`) e o endereço de resposta. Ele grava tudo no `.env.production` da VPS e recria o contêiner.
5. **Conferir.** Em Configurações → E-mail do Hub, use **Enviar um e-mail de teste para mim**.

## Variáveis (só no servidor)

| Variável | O que é |
|---|---|
| `RESEND_API_KEY` | chave de envio do Resend (`re_...`) |
| `HUB_EMAIL_FROM` | endereço do remetente, com o domínio verificado; o nome que aparece é o do workspace |
| `HUB_EMAIL_REPLY_TO` | opcional: para onde vão as respostas |

## Trocar ou desligar

- **Trocar a chave:** rode o script de novo.
- **Desligar:** revogue a chave no Resend, e os envios passam a falhar com a mensagem do provedor. Ou tire `RESEND_API_KEY` do `.env.production` e recrie o contêiner (`docs/operacao.md`, Trocar um segredo).

## Para quem mexe no código

O módulo é `app/src/lib/email.ts`:

- `sendEmail` manda só texto, para um destinatário, com a chave de repetição do Resend;
- `emailConfig` diz se o envio está ligado.

Ele devolve o motivo em vez de lançar erro. Todo e-mail novo precisa nascer de um clique de pessoa (a IA executa, o humano decide), e o histórico registra o envio sem o conteúdo.
