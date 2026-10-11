#!/usr/bin/env bash
# Hub de Gestão · liga o e-mail do Hub pelo Resend (docs/email.md). O próprio Fábio roda no
# Mac, com o botão Rodar, depois de verificar o domínio no Resend e criar a chave de envio.
# Faz, em ordem, e para no primeiro erro:
#   1. Pede a chave do Resend (o que você digita não aparece), o remetente e o endereço de
#      resposta.
#   2. Grava as variáveis no .env.production da VPS pelo hub-env-set.sh (os valores vão pela
#      entrada padrão, nunca na linha de comando; o ajudante confere o formato de cada um).
#   3. Recria o contêiner na versão no ar, esperando a publicação em andamento (alguns
#      segundos fora do ar).
#   4. Confere que o Hub voltou.
# O teste de verdade é o botão "Enviar um e-mail de teste para mim" em Configurações.
set -euo pipefail

readonly URL=https://hub.harmonydigital.com.br
here="$(cd "$(dirname "$0")" && pwd)"

echo "1/4 Dados do Resend."
read -rs -p "    Chave de envio do Resend (re_..., não aparece na tela): " key
echo
read -r -p "    Remetente, com o domínio verificado (ex.: hub@harmonydigital.com.br): " from
read -r -p "    Responder para (Enter para nenhum): " reply

echo "2/4 Gravando na VPS."
ssh vps-harmony 'mkdir -p ~/hub-gestao-staging'
scp -q "$here/hub-env-set.sh" "$here/hub-recreate.sh" vps-harmony:hub-gestao-staging/
printf '%s\n' "$key" |
  ssh vps-harmony 'sudo sh ~/hub-gestao-staging/hub-env-set.sh RESEND_API_KEY'
unset key
printf '%s\n' "$from" |
  ssh vps-harmony 'sudo sh ~/hub-gestao-staging/hub-env-set.sh HUB_EMAIL_FROM'
if [[ -n "$reply" ]]; then
  printf '%s\n' "$reply" |
    ssh vps-harmony 'sudo sh ~/hub-gestao-staging/hub-env-set.sh HUB_EMAIL_REPLY_TO'
fi

echo "3/4 Recriando o contêiner na versão no ar (alguns segundos fora do ar)."
ssh vps-harmony 'sudo bash ~/hub-gestao-staging/hub-recreate.sh'

echo "4/4 Conferindo."
code="$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/health")"
[[ "$code" == 200 ]] || { echo "O Hub respondeu $code em /api/health." >&2; exit 1; }
echo "Pronto. Confira em Configurações → E-mail do Hub → Enviar um e-mail de teste para mim."
