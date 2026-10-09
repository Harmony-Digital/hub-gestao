#!/usr/bin/env bash
# Hub de Gestão · parte do provisionamento que o próprio Fábio roda no Mac (M2).
#
# Faz, em ordem, e para no primeiro erro:
#   1. Gera a chave de publicação do GitHub Actions numa pasta temporária.
#   2. Na VPS, cria o acesso próprio do Hub no banco (etapa banco) e o usuário de
#      publicação com essa chave restrita ao comando de publicação (etapa publicador).
#   3. Confere que a chave entra no servidor e que só aceita o comando de publicação.
#   4. Guarda a parte privada no segredo HUB_VPS_SSH_KEY do repositório e apaga daqui.
# Nenhuma senha ou chave privada aparece na tela.
set -euo pipefail

readonly REPO=Harmony-Digital/hub-gestao
readonly VPS_IP=217.196.63.157

GH_TOKEN="$(gh auth token --user fabioalmeidadigital)"
export GH_TOKEN
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "1/4 Gerando a chave de publicação."
ssh-keygen -q -t ed25519 -N "" -C "hub-github-actions-$(date +%Y-%m-%d)" -f "$work/hub_deploy"

echo "2/4 Criando o acesso do Hub no banco e o usuário de publicação na VPS."
scp -q "$work/hub_deploy.pub" vps-harmony:hub-gestao-staging/hub-github-actions.pub
ssh vps-harmony 'sudo install -m 0644 -o root -g root ~/hub-gestao-staging/hub-github-actions.pub /opt/hub-gestao/config/hub-github-actions.pub && sudo /opt/hub-gestao/bin/hub-provision.sh banco && sudo /opt/hub-gestao/bin/hub-provision.sh publicador'

echo "3/4 Conferindo que a chave só aceita o comando de publicação."
set +e
answer="$(ssh -i "$work/hub_deploy" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o BatchMode=yes "hubdeploy@$VPS_IP" "qualquer-outro-comando" 2>&1)"
code=$?
set -e
if [[ $code -ne 64 || "$answer" != *"Comando de publicação inválido."* ]]; then
  echo "A chave não se comportou como esperado (código $code). Nada foi guardado no GitHub."
  exit 1
fi
echo "    Ok: a chave entra no servidor e recusa qualquer outro comando."

echo "4/4 Guardando a chave privada no GitHub."
gh secret set HUB_VPS_SSH_KEY --repo "$REPO" < "$work/hub_deploy"
echo "Pronto. A chave privada ficou só no GitHub e foi apagada deste computador."
