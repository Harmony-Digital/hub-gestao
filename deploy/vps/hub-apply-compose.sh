#!/usr/bin/env bash
# Hub de Gestão · aplica na VPS o docker-compose.yml do repositório (ex.: a rotação dos
# logs do contêiner, LGPD, M8; docs/privacidade.md). O próprio Fábio roda no Mac, com o
# botão Rodar. Faz, em ordem, e para no primeiro erro:
#   1. Mostra a diferença entre a cópia ativa na VPS e a do repositório (sai se não houver).
#   2. Envia a do repositório e confere a sintaxe com o próprio Docker, antes de trocar.
#   3. Guarda a cópia ativa (docker-compose.yml.bak-<data>) e instala a nova.
#   4. Recria o contêiner na versão que está no ar e espera ficar saudável (o Hub fica
#      alguns segundos fora do ar). Se não ficar, volta sozinho à cópia anterior.
#   5. Confere o /api/health e mostra a configuração de log do contêiner.
set -euo pipefail

readonly URL=https://hub.harmonydigital.com.br
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "1/5 Comparando com a cópia ativa na VPS."
ssh vps-harmony 'cat /opt/hub-gestao/config/docker-compose.yml' >"$work/ativo.yml"
if diff -u "$work/ativo.yml" "$here/docker-compose.yml"; then
  echo "    A VPS já usa este arquivo. Nada a fazer."
  exit 0
fi

echo "2/5 Enviando e conferindo a sintaxe."
ssh vps-harmony 'mkdir -p ~/hub-gestao-staging'
scp -q "$here/docker-compose.yml" vps-harmony:hub-gestao-staging/docker-compose.yml

ssh vps-harmony 'sudo bash -s' <<'REMOTO'
set -euo pipefail
config=/opt/hub-gestao/config/docker-compose.yml
envfile=/opt/hub-gestao/shared/.env.production
casa="$(getent passwd "${SUDO_USER:?rodar com sudo}" | cut -d: -f6)"
novo="$casa/hub-gestao-staging/docker-compose.yml"
sha="$(cat /opt/hub-gestao/shared/current-sha)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Versão atual ilegível." >&2; exit 1; }
export HUB_IMAGE_TAG="$sha"

docker compose --env-file "$envfile" --file "$novo" config --quiet </dev/null
echo "    Sintaxe conferida pelo Docker."

saudavel() {
  for _ in $(seq 1 40); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' hub-app 2>/dev/null || true)"
    [[ "$status" == healthy ]] && return 0
    sleep 3
  done
  return 1
}

echo "3/5 Guardando a cópia ativa e instalando a nova."
copia="$config.bak-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$config" "$copia"
install -m 0644 -o root -g root "$novo" "$config"
echo "    Cópia anterior em $copia."

echo "4/5 Recriando o contêiner (alguns segundos fora do ar)."
docker compose --env-file "$envfile" --file "$config" up --detach --no-build --force-recreate </dev/null
if saudavel; then
  echo "    Contêiner saudável com o arquivo novo."
  echo "    Log do contêiner: $(docker inspect --format '{{json .HostConfig.LogConfig}}' hub-app)"
  exit 0
fi

echo "O contêiner não ficou saudável: voltando à cópia anterior." >&2
docker logs --tail 60 hub-app >&2 || true
install -m 0644 -o root -g root "$copia" "$config"
docker compose --env-file "$envfile" --file "$config" up --detach --no-build --force-recreate </dev/null
saudavel && echo "Voltou à cópia anterior e está saudável." >&2
exit 1
REMOTO

echo "5/5 Conferindo o Hub."
code="$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/health")"
[[ "$code" == 200 ]] || { echo "O Hub respondeu $code em /api/health." >&2; exit 1; }
echo "Pronto: a VPS usa o docker-compose.yml do repositório."
