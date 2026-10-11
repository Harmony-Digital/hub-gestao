#!/usr/bin/env bash
# Hub de Gestão · liga o aviso de publicação que falhou (M8; docs/operacao.md, Alertas).
# O próprio Fábio roda no Mac, com o botão Rodar. Faz, em ordem, e para no primeiro erro:
#   1. Gera o segredo HUB_ALERT_SECRET (64 caracteres hexadecimais), só na memória.
#   2. Grava o segredo no .env.production da VPS pelo hub-env-set.sh (o valor vai pela
#      entrada padrão, nunca na linha de comando; troca o anterior, se houver).
#   3. Recria o contêiner na versão que está no ar, para ele ler o segredo, e espera
#      ficar saudável (o Hub fica alguns segundos fora do ar).
#   4. Guarda o mesmo valor no segredo HUB_ALERT_SECRET do repositório no GitHub.
#   5. Confere que o Hub voltou e que a rota do aviso recusa pedido sem o segredo (401).
# Rodar de novo troca o segredo nos dois lugares. O valor não aparece na tela e não
# fica neste computador.
set -euo pipefail

readonly REPO=Harmony-Digital/hub-gestao
readonly URL=https://hub.harmonydigital.com.br
here="$(cd "$(dirname "$0")" && pwd)"

GH_TOKEN="$(gh auth token --user fabioalmeidadigital)"
export GH_TOKEN

echo "1/5 Gerando o segredo."
secret="$(openssl rand -hex 32)"

echo "2/5 Gravando o segredo na VPS."
ssh vps-harmony 'mkdir -p ~/hub-gestao-staging'
scp -q "$here/hub-env-set.sh" vps-harmony:hub-gestao-staging/hub-env-set.sh
printf '%s\n' "$secret" |
  ssh vps-harmony 'sudo sh ~/hub-gestao-staging/hub-env-set.sh HUB_ALERT_SECRET'

echo "3/5 Recriando o contêiner na versão no ar (alguns segundos fora do ar)."
ssh vps-harmony 'sudo bash -s' <<'REMOTO'
set -euo pipefail
sha="$(cat /opt/hub-gestao/shared/current-sha)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Versão atual ilegível." >&2; exit 1; }
HUB_IMAGE_TAG="$sha" docker compose \
  --env-file /opt/hub-gestao/shared/.env.production \
  --file /opt/hub-gestao/config/docker-compose.yml \
  up --detach --no-build --force-recreate </dev/null
for _ in $(seq 1 40); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' hub-app 2>/dev/null || true)"
  [[ "$status" == healthy ]] && { echo "    Contêiner saudável."; exit 0; }
  sleep 3
done
echo "O contêiner não ficou saudável a tempo: ver docs/operacao.md (Voltar uma versão)." >&2
exit 1
REMOTO

echo "4/5 Guardando o segredo no GitHub."
printf '%s' "$secret" | gh secret set HUB_ALERT_SECRET --repo "$REPO"
unset secret

echo "5/5 Conferindo."
code="$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/health")"
[[ "$code" == 200 ]] || { echo "O Hub respondeu $code em /api/health." >&2; exit 1; }
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/api/internal/alerts/deploy")"
if [[ "$code" != 401 ]]; then
  echo "A rota do aviso respondeu $code (com o segredo ligado, recusa com 401)." >&2
  exit 1
fi
echo "Pronto: o aviso de publicação que falhou está ligado. O segredo ficou só na VPS e no GitHub."
