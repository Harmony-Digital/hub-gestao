#!/usr/bin/env bash
# Hub de Gestão · teste de restauração do backup (decisão D8, M8).
# Restaura o dump mais recente de /opt/hub-gestao/backups (ou o indicado) num banco
# temporário do mesmo Postgres, confere que as tabelas voltaram com dados, compara as
# contagens com o banco de produção (só leitura) e apaga o banco temporário no fim, com ou
# sem erro. Mostra só nomes de tabela e contagens: nenhum dado sai na tela.
#
# Uso (Fábio, no Mac, na pasta do repositório):
#   scp deploy/vps/hub-restore-test.sh vps-harmony:/tmp/hub-restore-test.sh
#   ssh -t vps-harmony 'sudo bash /tmp/hub-restore-test.sh'
# Para um dump específico: ... 'sudo bash /tmp/hub-restore-test.sh /opt/hub-gestao/backups/hub-<data>.dump'
set -Eeuo pipefail

readonly BACKUP_DIR="${HUB_BACKUP_DIR:-/opt/hub-gestao/backups}"
readonly DB_CONTAINER="supabase-db"
readonly SCHEMA="proj_hub_gestao"
readonly REPORT="${BACKUP_DIR}/restauracoes.log"
readonly TEMP_DB="hub_restauracao_$(date -u +%Y%m%d%H%M%S)"
CREATED=0

log() {
  printf '[hub-restauracao] %s\n' "$*"
}

# psql dentro do contêiner do banco, sem arquivo de configuração e parando no primeiro erro.
sql() {
  local db="$1"
  shift
  docker exec -i "$DB_CONTAINER" psql --host=127.0.0.1 --username=postgres \
    --dbname="$db" -v ON_ERROR_STOP=1 -X -q -t -A "$@"
}

cleanup() {
  if [[ "$CREATED" == 1 ]]; then
    if docker exec "$DB_CONTAINER" dropdb --host=127.0.0.1 --username=postgres \
      --if-exists "$TEMP_DB"; then
      log "Banco temporário ${TEMP_DB} apagado."
    else
      log "AVISO: não consegui apagar o banco temporário ${TEMP_DB}; apague à mão."
    fi
  fi
}

trap cleanup EXIT

main() {
  local dump="${1:-}"
  if [[ -z "$dump" ]]; then
    dump="$(ls -1t "$BACKUP_DIR"/hub-*.dump 2>/dev/null | head -n 1 || true)"
  fi
  [[ -n "$dump" && -s "$dump" ]] || {
    log "ERRO: nenhum dump encontrado em ${BACKUP_DIR}."
    exit 1
  }
  log "Dump: $(basename "$dump"), $(stat --format='%s' "$dump") bytes, de $(date -u -r "$dump" +%Y-%m-%dT%H:%MZ)."

  docker exec "$DB_CONTAINER" createdb --host=127.0.0.1 --username=postgres "$TEMP_DB"
  CREATED=1
  log "Banco temporário ${TEMP_DB} criado."

  if ! docker exec -i "$DB_CONTAINER" pg_restore --host=127.0.0.1 --username=postgres \
    --dbname="$TEMP_DB" --no-owner --no-privileges --exit-on-error < "$dump"; then
    log "ERRO: a restauração parou com erro (mensagem acima)."
    exit 1
  fi
  log "Restauração concluída sem erro."

  local tables table restored live count=0 total=0 differ=0
  tables="$(sql "$TEMP_DB" -c "select tablename from pg_tables where schemaname = '${SCHEMA}' order by 1")"
  printf '%-34s %12s %12s\n' "tabela" "restaurado" "produção"
  while read -r table; do
    [[ -z "$table" ]] && continue
    restored="$(sql "$TEMP_DB" -c "select count(*) from ${SCHEMA}.\"${table}\"")"
    live="$(sql postgres -c "select count(*) from ${SCHEMA}.\"${table}\"")"
    printf '%-34s %12s %12s\n' "$table" "$restored" "$live"
    count=$((count + 1))
    total=$((total + restored))
    [[ "$restored" != "$live" ]] && differ=$((differ + 1))
  done <<<"$tables"

  (( count > 0 && total > 0 )) || {
    log "ERRO: a restauração não trouxe tabela com dados."
    exit 1
  }
  log "OK: ${count} tabelas e ${total} linhas restauradas; ${differ} tabelas com contagem diferente da produção (o dump é de até 24 horas atrás)."
  printf '%s %s tabelas=%s linhas=%s diferentes=%s ok\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$dump")" "$count" "$total" "$differ" >>"$REPORT"
  log "Registro em ${REPORT}."
}

main "$@"
