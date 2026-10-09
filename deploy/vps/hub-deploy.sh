#!/usr/bin/env bash
# Hub de Gestão · publicação na VPS (padrão do Certato).
# Recebe a imagem de um commit da main pela entrada padrão, confere que ela é daquele
# commit, troca o contêiner e volta para a versão anterior se a nova não ficar saudável.
# Cópia ativa: /opt/hub-gestao/bin/hub-deploy.sh (root), chamada só pelo hub-deploy-ssh.sh.
set -Eeuo pipefail

readonly ROOT_DIR="/opt/hub-gestao"
readonly SHARED_DIR="${ROOT_DIR}/shared"
readonly ENV_FILE="${SHARED_DIR}/.env.production"
readonly COMPOSE_FILE="${ROOT_DIR}/config/docker-compose.yml"
readonly STATE_FILE="${SHARED_DIR}/current-sha"
readonly PREVIOUS_FILE="${SHARED_DIR}/previous-sha"
readonly LOCK_FILE="/run/lock/hub-gestao-deploy.lock"
readonly MAX_IMAGE_BYTES=1073741824
IMAGE_ARCHIVE=""

cleanup() {
  if [[ -n "$IMAGE_ARCHIVE" ]]; then
    rm -f -- "$IMAGE_ARCHIVE"
  fi
}

trap cleanup EXIT

log() {
  printf '[hub-deploy] %s\n' "$*"
}

fail() {
  log "ERRO: $*"
  exit 1
}

wait_healthy() {
  local attempt status
  for attempt in $(seq 1 40); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' hub-app 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]]; then
      return 1
    fi
    sleep 3
  done
  return 1
}

rollback() {
  local previous_sha="$1"
  [[ "$previous_sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  docker image inspect "hub-gestao:${previous_sha}" >/dev/null 2>&1 || return 1

  log "Restaurando a versão anterior ${previous_sha}."
  HUB_IMAGE_TAG="$previous_sha" docker compose \
    --env-file "$ENV_FILE" \
    --file "$COMPOSE_FILE" \
    up --detach --no-build
  wait_healthy
}

main() {
  local requested_sha="${1:-}"
  local current_sha=""
  local archive_size=0
  local image_revision=""

  exec 9>"$LOCK_FILE"
  flock -n 9 || fail "já existe uma publicação em andamento"

  [[ "$requested_sha" =~ ^[0-9a-f]{40}$ ]] || fail "commit inválido"
  [[ -s "$ENV_FILE" ]] || fail "arquivo de ambiente ausente"

  if [[ -f "$STATE_FILE" ]]; then
    current_sha="$(tr -d '[:space:]' < "$STATE_FILE")"
  fi

  IMAGE_ARCHIVE="$(mktemp "${SHARED_DIR}/hub-image.XXXXXX.tar.gz")"
  chmod 0600 "$IMAGE_ARCHIVE"

  log "Recebendo a imagem do commit ${requested_sha}."
  timeout 20m dd of="$IMAGE_ARCHIVE" bs=1M status=none
  archive_size="$(stat --format='%s' "$IMAGE_ARCHIVE")"
  (( archive_size > 0 && archive_size <= MAX_IMAGE_BYTES )) \
    || fail "imagem vazia ou acima do limite de 1 GB"
  gzip --test "$IMAGE_ARCHIVE" || fail "arquivo de imagem inválido"
  gzip --decompress --stdout "$IMAGE_ARCHIVE" | docker load >/dev/null

  docker image inspect "hub-gestao:${requested_sha}" >/dev/null 2>&1 \
    || fail "a imagem não tem a etiqueta esperada"
  image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "hub-gestao:${requested_sha}")"
  [[ "$image_revision" == "$requested_sha" ]] \
    || fail "a revisão declarada na imagem não confere"

  log "Ativando a versão ${requested_sha}."
  if ! HUB_IMAGE_TAG="$requested_sha" docker compose \
    --env-file "$ENV_FILE" \
    --file "$COMPOSE_FILE" \
    up --detach --no-build; then
    rollback "$current_sha" || true
    fail "não foi possível iniciar a nova versão"
  fi

  if ! wait_healthy; then
    docker logs --tail 120 hub-app >&2 || true
    rollback "$current_sha" || true
    fail "a nova versão não ficou saudável"
  fi

  if [[ "$current_sha" =~ ^[0-9a-f]{40}$ && "$current_sha" != "$requested_sha" ]]; then
    printf '%s\n' "$current_sha" > "$PREVIOUS_FILE"
  fi
  printf '%s\n' "$requested_sha" > "$STATE_FILE"
  log "Versão ${requested_sha} publicada e saudável."
}

main "$@"
