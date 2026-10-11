#!/usr/bin/env bash
# Hub de Gestão · cópia diária do backup fora da VPS (decisão D8: Google Drive).
# Cifra o dump mais recente com gpg (AES-256; a senha fica só na VPS e no Keychain do
# Fábio), envia para a pasta hub-gestao-backups do Google Drive pelo rclone (escopo
# drive.file: ele só enxerga o que ele mesmo criou), confere o tamanho lá e apaga do
# Drive as cópias com mais de 30 dias. O nome do arquivo não tem dado nenhum além da data.
# Cópia ativa: /opt/hub-gestao/bin/hub-backup-offsite.sh (root), chamada pelo
# hub-backup-offsite.timer, depois do backup das 06:00 UTC.
#
# Modos:
#   (sem argumento)  envia a cópia do dump do dia;
#   --conferir       falha se a cópia mais recente no Drive tiver mais de 48 horas;
#   --testar-volta   baixa a cópia mais recente, decifra e confere que o dump abre.
set -Eeuo pipefail

readonly BACKUP_DIR="${HUB_BACKUP_DIR:-/opt/hub-gestao/backups}"
readonly SHARED_DIR="${HUB_SHARED_DIR:-/opt/hub-gestao/shared}"
readonly RCLONE_CONFIG="${SHARED_DIR}/rclone.conf"
readonly PASSPHRASE_FILE="${SHARED_DIR}/backup-passphrase"
readonly REMOTE="hubdrive:hub-gestao-backups"
readonly KEEP_DAYS=30
readonly MAX_DUMP_AGE_HOURS=26
readonly MAX_COPY_AGE_HOURS=48
readonly DB_CONTAINER="supabase-db"
readonly NAME_RE='^hub-([0-9]{8})T([0-9]{6})Z\.dump\.gpg$'
readonly GPG=(gpg --batch --yes --quiet --no-symkey-cache --pinentry-mode loopback)
# Arquivo ou pasta temporária da vez. Global de propósito: no bash 5, a limpeza do fim
# (trap EXIT) não enxerga variável local quando o script sai por erro.
TMP_PATH=""

cleanup() {
  if [[ -n "$TMP_PATH" ]]; then
    rm -rf -- "$TMP_PATH"
  fi
}

trap cleanup EXIT

log() {
  printf '[hub-backup-offsite] %s\n' "$*"
}

fail() {
  log "ERRO: $*"
  exit 1
}

rc() {
  rclone --config "$RCLONE_CONFIG" "$@"
}

# Avisa o Hub que o backup deu certo; sem aviso por 30 horas, o Hub alerta o dono. Com o
# contêiner fora do ar (ou numa versão sem o script), segue sem o aviso.
report() {
  if docker exec hub-app node /app/scripts/backup-report.mjs "$1" "$2" "$3" >/dev/null 2>&1; then
    log "Aviso entregue ao Hub."
  else
    log "Aviso: o Hub não recebeu o registro deste backup (contêiner fora do ar ou versão antiga)."
  fi
}

require_setup() {
  [[ -s "$RCLONE_CONFIG" ]] || fail "falta ${RCLONE_CONFIG}: rodar o hub-backup-offsite-setup.sh no Mac."
  [[ -s "$PASSPHRASE_FILE" ]] || fail "falta ${PASSPHRASE_FILE}: rodar o hub-backup-offsite-setup.sh no Mac."
}

# Nome da cópia mais recente no Drive (os nomes levam a data em UTC, então a ordem do
# nome é a ordem do tempo). Vazio se não houver nenhuma.
newest_copy() {
  rc lsf --files-only --include 'hub-*.dump.gpg' "$REMOTE" | LC_ALL=C sort | tail -n 1
}

copy_epoch() {
  local name="$1"
  [[ "$name" =~ $NAME_RE ]] || fail "nome de cópia inesperado: $name"
  local d="${BASH_REMATCH[1]}" t="${BASH_REMATCH[2]}"
  date -u -d "${d:0:4}-${d:4:2}-${d:6:2} ${t:0:2}:${t:2:2}:${t:4:2}" +%s
}

send() {
  local latest name local_size remote_size dump_age_h
  latest="$(find "$BACKUP_DIR" -maxdepth 1 -name 'hub-*.dump' | LC_ALL=C sort | tail -n 1)"
  [[ -n "$latest" ]] || fail "nenhum dump em $BACKUP_DIR"
  dump_age_h=$((($(date +%s) - $(stat --format=%Y "$latest")) / 3600))
  ((dump_age_h < MAX_DUMP_AGE_HOURS)) ||
    fail "o dump mais recente ($(basename "$latest")) tem ${dump_age_h} horas: o backup do dia não rodou"

  name="$(basename "$latest").gpg"
  TMP_PATH="$(mktemp "${BACKUP_DIR}/.offsite.XXXXXX")"
  chmod 0600 "$TMP_PATH"
  "${GPG[@]}" --passphrase-file "$PASSPHRASE_FILE" \
    --symmetric --cipher-algo AES256 --output "$TMP_PATH" "$latest"
  local_size="$(stat --format=%s "$TMP_PATH")"

  rc copyto "$TMP_PATH" "${REMOTE}/${name}"
  remote_size="$(rc lsf --files-only --format sp --separator ' ' --include "/${name}" "$REMOTE" | cut -d' ' -f1)"
  [[ "$remote_size" == "$local_size" ]] ||
    fail "a cópia no Drive tem '${remote_size}' bytes; a local, ${local_size}"
  cleanup
  TMP_PATH=""
  log "Cópia enviada: ${name} (${local_size} bytes, cifrada)."
  report offsite "$name" "$local_size"

  rc delete --min-age "${KEEP_DAYS}d" --include 'hub-*.dump.gpg' "$REMOTE"
  log "Cópias no Drive: $(rc lsf --files-only --include 'hub-*.dump.gpg' "$REMOTE" | wc -l | tr -d ' ') (até ${KEEP_DAYS} dias)."
}

check() {
  local newest age_h
  newest="$(newest_copy)"
  [[ -n "$newest" ]] || fail "nenhuma cópia no Drive"
  age_h=$((($(date +%s) - $(copy_epoch "$newest")) / 3600))
  ((age_h <= MAX_COPY_AGE_HOURS)) ||
    fail "a cópia mais recente no Drive (${newest}) tem ${age_h} horas"
  log "OK: a cópia mais recente no Drive é ${newest} (${age_h} horas)."
}

roundtrip() {
  local newest listing tables
  newest="$(newest_copy)"
  [[ -n "$newest" ]] || fail "nenhuma cópia no Drive"
  TMP_PATH="$(mktemp -d "${BACKUP_DIR}/.volta.XXXXXX")"
  rc copyto "${REMOTE}/${newest}" "${TMP_PATH}/${newest}"
  "${GPG[@]}" --passphrase-file "$PASSPHRASE_FILE" \
    --decrypt --output "${TMP_PATH}/volta.dump" "${TMP_PATH}/${newest}"
  listing="$(docker exec -i "$DB_CONTAINER" pg_restore --list <"${TMP_PATH}/volta.dump")" ||
    fail "o dump decifrado não abre"
  tables="$(grep -c "TABLE DATA" <<<"$listing" || true)"
  ((tables > 0)) || fail "o dump decifrado está vazio"
  local plural="tabelas"
  ((tables == 1)) && plural="tabela"
  log "OK: ${newest} baixado do Drive, decifrado e o dump abre (${tables} ${plural} com dados)."
}

main() {
  require_setup
  # Temporário de uma execução interrompida (processo morto no meio): sai no dia seguinte.
  find "$BACKUP_DIR" -maxdepth 1 \( -name '.offsite.*' -o -name '.volta.*' \) -mmin +1440 \
    -exec rm -rf -- {} + 2>/dev/null || true
  case "${1:-}" in
    "") send ;;
    --conferir) check ;;
    --testar-volta) roundtrip ;;
    *) fail "modo desconhecido: $1 (use --conferir ou --testar-volta)" ;;
  esac
}

main "$@"
