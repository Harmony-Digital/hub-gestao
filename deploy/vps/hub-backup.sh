#!/usr/bin/env bash
# Hub de Gestão · backup diário do schema proj_hub_gestao (decisão D8, antecipado para o M2).
# Gera um dump no formato custom, confere que ele abre, guarda 14 dias em
# /opt/hub-gestao/backups (root, 0700) e apaga os mais antigos.
# A cópia fora da VPS (Google Drive, cifrada) é do hub-backup-offsite.sh, 45 minutos depois.
# Cópia ativa: /opt/hub-gestao/bin/hub-backup.sh (root), chamada pelo hub-backup.timer.
set -Eeuo pipefail

readonly BACKUP_DIR="/opt/hub-gestao/backups"
readonly RETENTION_DAYS=14
readonly DB_CONTAINER="supabase-db"
readonly SCHEMA="proj_hub_gestao"
# Arquivo temporário do dump da vez. Global de propósito: no bash 5, a limpeza do fim
# (trap EXIT) não enxerga variável local quando o script sai por erro, e o arquivo ficava.
TMP_FILE=""

cleanup() {
  if [[ -n "$TMP_FILE" ]]; then
    rm -f -- "$TMP_FILE"
  fi
}

trap cleanup EXIT

log() {
  printf '[hub-backup] %s\n' "$*"
}

main() {
  local stamp final size
  install -d -m 0700 "$BACKUP_DIR"
  # Temporário de uma execução interrompida (processo morto no meio): sai no dia seguinte.
  find "$BACKUP_DIR" -maxdepth 1 -name '.hub-*' -mmin +1440 -print -delete \
    | sed 's/^/[hub-backup] temporário antigo removido: /'
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  TMP_FILE="$(mktemp "${BACKUP_DIR}/.hub-${stamp}.XXXXXX")"
  chmod 0600 "$TMP_FILE"

  log "Gerando o dump do schema ${SCHEMA}."
  docker exec "$DB_CONTAINER" pg_dump \
    --host=127.0.0.1 --username=postgres --dbname=postgres \
    --schema="$SCHEMA" --format=custom --no-owner --no-privileges \
    > "$TMP_FILE"

  # O dump só conta se abrir: a lista de objetos precisa sair sem erro e não vazia.
  # A lista vai para uma variável antes da busca, para o grep não cortar a saída no meio
  # (com pipefail, isso viraria uma falha falsa).
  local listing
  listing="$(docker exec -i "$DB_CONTAINER" pg_restore --list < "$TMP_FILE")" \
    || { log "ERRO: o dump gerado não abre."; exit 1; }
  grep -q "TABLE DATA" <<<"$listing" \
    || { log "ERRO: o dump gerado está vazio."; exit 1; }

  final="${BACKUP_DIR}/hub-${stamp}.dump"
  mv -- "$TMP_FILE" "$final"
  TMP_FILE=""
  size="$(stat --format='%s' "$final")"
  log "Backup pronto: $(basename "$final") (${size} bytes)."

  find "$BACKUP_DIR" -maxdepth 1 -name 'hub-*.dump' -mtime "+${RETENTION_DAYS}" -print -delete \
    | sed 's/^/[hub-backup] removido: /'
}

main "$@"
