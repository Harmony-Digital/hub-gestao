#!/usr/bin/env bash
# Hub de Gestão · recria o contêiner na versão que está no ar, para ele ler de novo o
# .env.production (roda como root na VPS; os scripts de um clique mandam e chamam).
# Espera a publicação em andamento terminar (a mesma trava do hub-deploy.sh), para nunca
# voltar o contêiner para a versão anterior, e espera o contêiner ficar saudável.
set -euo pipefail

exec 9>/run/lock/hub-gestao-deploy.lock
flock -w 900 9 || {
  echo "Há uma publicação em andamento há mais de 15 minutos; rode de novo depois." >&2
  exit 1
}
sha="$(cat /opt/hub-gestao/shared/current-sha)"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Versão atual ilegível." >&2; exit 1; }
HUB_IMAGE_TAG="$sha" docker compose \
  --env-file /opt/hub-gestao/shared/.env.production \
  --file /opt/hub-gestao/config/docker-compose.yml \
  up --detach --no-build --force-recreate </dev/null
for _ in $(seq 1 40); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' hub-app 2>/dev/null || true)"
  if [[ "$status" == healthy ]]; then
    echo "    Contêiner saudável."
    exit 0
  fi
  sleep 3
done
echo "O contêiner não ficou saudável a tempo: ver docs/operacao.md (Voltar uma versão)." >&2
exit 1
